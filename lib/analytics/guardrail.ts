/**
 * 安全围栏：对模型生成的 SQL 做三层校验。
 *
 * 对应赛题的攻关任务二——「设计安全围栏模块，包括但不限于表、指标、结果的合法性验证，
 * 一方面是尽可能减少大模型幻觉，另一方面是降低大模型幻觉带来的影响」。
 *
 * 三层各管一件事：
 *   结构层——单条只读查询、禁止注释、顶层必须有行数上限，先堵住破坏性操作与全表扫描；
 *   语义层——表名、**按表校验的列名**、CTE 名字白名单，指标声明必须已登记，命中幻觉即拦截；
 *   结果层——行数列数与数值合理性检查，兜住「语法合法但结果荒谬」的情况。
 *
 * 每一条命中都产出结构化 finding 并写入审计，因此「拦了什么、依据哪条规则」可还原。
 *
 * 校验严格程度的分工：**出现即拦截的必须是确定性的错误**（写操作、未知表、跨表幻觉列、
 * 未登记指标）；对「可疑但可能正确」的情况（行数偏多、金额量级异常）只提醒不拦截，
 * 避免把正常查询误杀成拒绝服务。
 */
import { analyticsColumnWhitelist, analyticsTableNames, tableLabel } from './schema';
import { analyticsMetrics } from './metadata';

export type GuardrailLayer = '结构' | '语义' | '结果';
export type GuardrailDisposition = '拦截' | '提醒';
export type GuardrailFinding = {
  layer: GuardrailLayer;
  rule: string;
  title: string;
  disposition: GuardrailDisposition;
  detail: string;
  /** 命中的原文片段，便于定位 */
  excerpt: string;
};

export type GuardrailCheck = {
  passed: boolean;
  findings: GuardrailFinding[];
  /** 规范化后的 SQL：缺 LIMIT 时会自动补上 */
  normalizedSql: string;
  tables: string[];
};

export const guardrailMaxRows = 1000;
export const guardrailMaxColumns = 30;
export const guardrailResultRowLimit = 200;
/** 单条金额的量级上限（10 万亿元）：超过它基本就是单位或口径错了 */
export const guardrailMaxAmount = 1e13;

/**
 * 禁止关键字。这里只放「不可能作为函数名出现」的写操作与库级操作：
 * REPLACE 既可以是写语句也可以是字符串函数，放进来会把 REPLACE(cust_name,…) 误拦，
 * 因此它由「语句必须以 SELECT/WITH 开头」这条规则兜住。
 */
const forbiddenKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'GRANT', 'REVOKE'];

/** SQL 关键字与常用内置函数。缺少某个函数会误拦正常查询，因此这里宁可放宽。 */
const allowedFunctions = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'AS', 'ON', 'JOIN', 'LEFT', 'RIGHT', 'FULL', 'INNER', 'OUTER', 'CROSS', 'NATURAL',
  'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'EXISTS', 'BETWEEN', 'LIKE', 'GLOB', 'IS', 'NULL', 'INTO', 'WITH',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DISTINCT', 'ASC', 'DESC', 'OVER', 'PARTITION', 'ROWS', 'RANGE',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'TOTAL', 'ROUND', 'ABS', 'CAST', 'COALESCE', 'IFNULL', 'NULLIF', 'IIF', 'LENGTH', 'LOWER', 'UPPER',
  'SUBSTR', 'SUBSTRING', 'TRIM', 'LTRIM', 'RTRIM', 'REPLACE', 'GROUP_CONCAT', 'PRINTF', 'MOD', 'REAL', 'INTEGER', 'TEXT', 'NUMERIC',
  'DATE', 'TIME', 'DATETIME', 'JULIANDAY', 'STRFTIME', 'NOW', 'DAY', 'MONTH', 'YEAR', 'HOUR', 'MINUTE', 'SECOND', 'CURRENT_DATE', 'CURRENT_TIME',
  'CURRENT_TIMESTAMP', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
]);

/** 去掉字符串字面量，避免把常量误判成标识符，也避免字符串里的 -- 被当成注释。 */
function stripLiterals(sql: string) {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * 把字符串字面量换成等长空格：既避免把字面量内容当代码，又保持下标与原文一一对应。
 * 用长度会变的 stripLiterals 去算下标，会切到字面量中间——这是上一版把 SQL 切坏的原因。
 */
function maskLiterals(sql: string) {
  return sql.replace(/'(?:[^']|'')*'/g, (match) => ' '.repeat(match.length));
}

function tokenize(sql: string) {
  return (stripLiterals(sql).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).map((token) => token.toUpperCase());
}

/** 去掉所有括号内的内容，用于只检查「顶层」是否存在 LIMIT。 */
function topLevel(sql: string) {
  let current = sql;
  let previous = '';
  while (current !== previous) {
    previous = current;
    current = current.replace(/\([^()]*\)/g, '()');
  }
  return current;
}

type TableRef = { table: string; alias: string | null };

/** 抽取 FROM / JOIN 引用的表与别名。 */
function extractTableRefs(sql: string): TableRef[] {
  return [...stripLiterals(sql).matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi)]
    .map((match) => {
      const alias = match[2] ?? '';
      const isAlias = alias.length > 0 && !allowedFunctions.has(alias.toUpperCase());
      return { table: match[1].toLowerCase(), alias: isAlias ? alias.toLowerCase() : null };
    });
}

/** 抽取派生表别名：FROM ( ... ) t / JOIN ( ... ) x，这类别名指向子查询而不是物理表。 */
function extractDerivedAliases(sql: string): string[] {
  return [...stripLiterals(sql).matchAll(/\)\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)]
    .map((match) => match[1].toLowerCase())
    .filter((alias) => !allowedFunctions.has(alias.toUpperCase()));
}

/** 抽取 WITH ... AS ( ... ) 定义的 CTE 名字。 */
function extractCteNames(sql: string): string[] {
  return [...stripLiterals(sql).matchAll(/(?:WITH\b|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi)].map((match) => match[1].toLowerCase());
}

/**
 * 结构层与语义层校验。返回规范化 SQL（缺 LIMIT 会自动补）。
 * 只要出现「拦截」级 finding，passed 即为 false，调用方不得执行。
 */
export function inspectSql(rawSql: string): GuardrailCheck {
  const findings: GuardrailFinding[] = [];
  const sql = rawSql.trim().replace(/;+\s*$/, '');
  const stripped = stripLiterals(sql);
  const upper = stripped.toUpperCase();

  // 结构层
  if (!/^(SELECT|WITH)\b/.test(upper)) {
    findings.push({
      layer: '结构', rule: 'G-STRUCT-02', title: '只允许查询语句', disposition: '拦截',
      detail: 'SQL 必须以 SELECT 或 WITH 开头，其他语句一律不执行。', excerpt: sql.slice(0, 80),
    });
  }
  if (stripped.includes(';')) {
    findings.push({
      layer: '结构', rule: 'G-STRUCT-01', title: '只允许单条语句', disposition: '拦截',
      detail: '检测到语句分隔符，可能存在多语句执行，已拒绝。', excerpt: sql.slice(0, 80),
    });
  }
  const forbidden = forbiddenKeywords.filter((keyword) => new RegExp(`\\b${keyword}\\b`).test(upper));
  if (forbidden.length > 0) {
    findings.push({
      layer: '结构', rule: 'G-STRUCT-03', title: '禁止写操作与库级操作', disposition: '拦截',
      detail: `命中禁止关键字：${forbidden.join('、')}。查询只读，不允许修改数据或结构。`, excerpt: forbidden.join('、'),
    });
  }
  // 注释检测必须跑在「去掉字符串字面量」的版本上，否则 LIKE '%--%' 会被误判成注释
  if (/--|\/\*/.test(stripped)) {
    findings.push({
      layer: '结构', rule: 'G-STRUCT-04', title: '禁止在查询中使用注释', disposition: '拦截',
      detail: '注释可能被用于绕过校验，已拒绝。', excerpt: sql.slice(0, 80),
    });
  }

  let normalizedSql = sql;
  const totalLimitMatch = /\bLIMIT\s+(\d+)\b/i.exec(topLevel(maskLiterals(sql)));
  const anyLimitMatch = /\bLIMIT\s+(\d+)\b/i.exec(stripped);
  /** 把最外层的那条 LIMIT 换成上限值：子查询里的 LIMIT 不能代表外层，所以取最后一次出现。 */
  const clampTopLevelLimit = () => {
    // 必须在原文（而非去字面量后的版本）上定位：掩码与原文等长，下标才可直接用于切片
    const matches = [...maskLiterals(sql).matchAll(/\bLIMIT\s+(\d+)\b/gi)];
    const last = matches[matches.length - 1];
    if (!last || last.index === undefined) return sql;
    return sql.slice(0, last.index) + `LIMIT ${guardrailMaxRows}` + sql.slice(last.index + last[0].length);
  };
  if (totalLimitMatch) {
    if (Number(totalLimitMatch[1]) > guardrailMaxRows) {
      normalizedSql = clampTopLevelLimit();
      findings.push({
        layer: '结构', rule: 'G-STRUCT-05', title: '行数上限过大，已收敛', disposition: '提醒',
        detail: `外层 LIMIT ${totalLimitMatch[1]} 超过上限 ${guardrailMaxRows}，已收敛到上限值。`, excerpt: totalLimitMatch[0],
      });
    }
  } else if (anyLimitMatch) {
    // 子查询里的 LIMIT 不能给外层结果兜底，必须在外层补一条
    normalizedSql = `${sql} LIMIT ${guardrailMaxRows}`;
    findings.push({
      layer: '结构', rule: 'G-STRUCT-06', title: '只有子查询带行数上限，已在外层补全', disposition: '提醒',
      detail: `LIMIT 出现在子查询里，外层结果没有行数上限，已在外层补为 ${guardrailMaxRows}。`, excerpt: anyLimitMatch[0],
    });
  } else {
    normalizedSql = `${sql} LIMIT ${guardrailMaxRows}`;
    findings.push({
      layer: '结构', rule: 'G-STRUCT-05', title: '缺少行数上限，已自动补全', disposition: '提醒',
      detail: `查询未指定 LIMIT，已补为 ${guardrailMaxRows}，避免全表返回拖慢响应。`, excerpt: 'LIMIT',
    });
  }

  // 语义层：表名。CTE 名字不是物理表，必须放行，否则模型一用 WITH 就被拦。
  const cteNames = extractCteNames(sql);
  const refs = extractTableRefs(sql);
  const tables = refs.map((ref) => ref.table);
  const unknownTables = [...new Set(tables)].filter(
    (name) => !analyticsTableNames.includes(name) && !cteNames.includes(name),
  );
  if (unknownTables.length > 0) {
    findings.push({
      layer: '语义', rule: 'G-SEM-01', title: '引用了不存在的表', disposition: '拦截',
      detail: `未在元数据中登记的表：${unknownTables.join('、')}。可用表为：${analyticsTableNames.join('、')}。`, excerpt: unknownTables.join('、'),
    });
  }
  if (tables.length === 0) {
    findings.push({
      layer: '语义', rule: 'G-SEM-02', title: '未识别到数据表', disposition: '拦截',
      detail: '查询没有 FROM 子句或表名无法识别，拒绝执行。', excerpt: sql.slice(0, 80),
    });
  }

  // 别名 → 表：只有建立这层映射，才能把「列」按所属表校验
  const aliasToTable = new Map<string, string>();
  for (const ref of refs) {
    if (analyticsTableNames.includes(ref.table)) aliasToTable.set(ref.table, ref.table);
    if (ref.alias) aliasToTable.set(ref.alias, ref.table);
  }
  // CTE 名与派生表别名指向的是子查询而不是物理表，列无法按表校验，但作为限定符必须放行
  const opaqueAliases = new Set<string>([...cteNames, ...extractDerivedAliases(sql)]);

  // 语义层：带表前缀的列引用必须属于该表（跨表幻觉字段的关键拦截点）
  const qualifiedBad: string[] = [];
  for (const match of stripped.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const alias = match[1].toLowerCase();
    const column = match[2].toLowerCase();
    if (opaqueAliases.has(alias)) continue;
    const owner = aliasToTable.get(alias);
    if (!owner) {
      qualifiedBad.push(match[0]);
      continue;
    }
    // CTE 的列无法校验，跳过；物理表必须落在该表的列白名单里
    if (!analyticsTableNames.includes(owner)) continue;
    if (!analyticsColumnWhitelist[owner]?.has(column)) qualifiedBad.push(match[0]);
  }
  if (qualifiedBad.length > 0) {
    findings.push({
      layer: '语义', rule: 'G-SEM-05', title: '字段与所属表不匹配', disposition: '拦截',
      detail: `以下引用不属于它所在的表：${[...new Set(qualifiedBad)].join('、')}。常见原因是把别的表的字段写到了这张表上。`,
      excerpt: [...new Set(qualifiedBad)].join('、'),
    });
  }

  // 语义层：无表前缀的列名必须属于本次查询里出现的某张表。
  // 只做「全集白名单」是不够的——market_value 写在 cust_info 上同样是幻觉字段，
  // 只有把校验范围收敛到本次查询用到的表，列级验证才真正成立。
  const outputAliases = new Set(
    [...stripped.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((match) => match[1].toLowerCase()),
  );
  if (cteNames.length === 0) {
    const allColumns = new Set(Object.values(analyticsColumnWhitelist).flatMap((set) => [...set]));
    const queryColumns = new Set<string>();
    for (const name of new Set(tables)) {
      analyticsColumnWhitelist[name]?.forEach((column) => queryColumns.add(column));
    }
    // 输出别名（AS hold_value 之类）与真正引用的字段是两回事，不能当成幻觉字段
    const foreignColumns = [...new Set(tokenize(sql))].filter((token) =>
      allColumns.has(token.toLowerCase())
      && !queryColumns.has(token.toLowerCase())
      && !outputAliases.has(token.toLowerCase()));
    if (foreignColumns.length > 0) {
      findings.push({
        layer: '语义', rule: 'G-SEM-06', title: '字段不属于本次查询的表', disposition: '拦截',
        detail: `以下字段在别的表里存在，但不属于本次查询用到的表（${[...new Set(tables)].join('、')}）：${foreignColumns.join('、')}。`,
        excerpt: foreignColumns.join('、'),
      });
    }
  } else {
    // CTE 的输出列名无法预先知道，这一条校验只能跳过——但要显式留痕，不能静默放行
    findings.push({
      layer: '语义', rule: 'G-SEM-07', title: '使用了 CTE，字段归属校验已跳过', disposition: '提醒',
      detail: `查询使用了 CTE（${cteNames.join('、')}），其输出列名无法与元数据比对，本次跳过「字段是否属于该表」的校验；带表前缀的引用仍然照常校验。`,
      excerpt: cteNames.join('、'),
    });
  }

  // 语义层：标识符白名单（表名 ∪ 列名 ∪ 表别名 ∪ 列别名 ∪ CTE 名 ∪ 函数关键字）
  const knownIdentifiers = new Set<string>([
    ...analyticsTableNames,
    ...cteNames,
    ...opaqueAliases,
    ...Object.values(analyticsColumnWhitelist).flatMap((set) => [...set]),
    ...aliasToTable.keys(),
    ...[...stripped.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((match) => match[1].toLowerCase()),
  ]);
  const unknownIdentifiers = [...new Set(tokenize(sql))].filter((token) => {
    if (knownIdentifiers.has(token.toLowerCase()) || allowedFunctions.has(token)) return false;
    // 已经被「字段与所属表不匹配」报过的引用不再重复报
    return !qualifiedBad.some((bad) => bad.toUpperCase().endsWith(`.${token}`));
  });
  if (unknownIdentifiers.length > 0) {
    findings.push({
      layer: '语义', rule: 'G-SEM-03', title: '引用了未登记的字段或函数', disposition: '拦截',
      detail: `以下标识符不在元数据白名单内：${unknownIdentifiers.join('、')}。可能是模型臆造的字段名，也可能是围栏的函数白名单没有收录。`,
      excerpt: unknownIdentifiers.join('、'),
    });
  }

  return {
    passed: !findings.some((finding) => finding.disposition === '拦截'),
    findings,
    normalizedSql,
    tables: [...new Set(tables)],
  };
}

/**
 * 指标声明校验：模型在 JSON 里声明的指标必须已登记在指标注册表里。
 * 指标不能用自然语言解释，只能引用登记项——这是「指标合法性验证」的落点。
 */
export function inspectMetrics(declared: string[]): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];
  if (declared.length === 0) return findings;
  const known = new Set<string>();
  for (const metric of analyticsMetrics) {
    known.add(metric.name.toLowerCase());
    known.add(metric.label.toLowerCase());
  }
  const unknown = declared.filter((item) => !known.has(item.trim().toLowerCase()));
  if (unknown.length > 0) {
    findings.push({
      layer: '语义', rule: 'G-SEM-04', title: '引用了未登记的指标', disposition: '拦截',
      detail: `以下指标不在指标注册表内：${unknown.join('、')}。未登记指标一律不允许出现在取数结果的口径说明里。`,
      excerpt: unknown.join('、'),
    });
  }
  return findings;
}

/** 结果层校验：执行完成后调用，只产出提醒，不改变结果本身。 */
export function inspectResult(
  columns: string[],
  rows: Array<Record<string, unknown>>,
  options: { customerCount?: number } = {},
): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];

  if (rows.length > guardrailResultRowLimit) {
    findings.push({
      layer: '结果', rule: 'G-RES-01', title: '返回行数偏多', disposition: '提醒',
      detail: `本次返回 ${rows.length} 行，超过展示上限 ${guardrailResultRowLimit}，界面只展示前若干行。`, excerpt: `${rows.length} 行`,
    });
  }
  if (columns.length > guardrailMaxColumns) {
    findings.push({
      layer: '结果', rule: 'G-RES-02', title: '返回列数偏多', disposition: '提醒',
      detail: `本次返回 ${columns.length} 列，建议收窄查询范围。`, excerpt: `${columns.length} 列`,
    });
  }
  if (rows.length === 0) {
    findings.push({
      layer: '结果', rule: 'G-RES-03', title: '没有符合条件的数据', disposition: '提醒',
      detail: '查询语法正确但没有命中数据。可能是筛选条件过严，也可能是问题本身在当前数据下无解。', excerpt: '0 行',
    });
  }

  // 金额类列名中英混用：SQL 里常是英文列名，展示时是中文别名，两边都要覆盖
  const amountPattern = /(asset|value|amount|balance|市值|金额|资产|余额|成本)/;
  const countPattern = /(客户数|人数|数量|笔数|条数|个数)/;
  for (const column of columns) {
    const isAmount = amountPattern.test(column) && !/收益率|profit/i.test(column);
    const isRatio = /ratio/i.test(column);
    const isCount = countPattern.test(column);
    for (const row of rows.slice(0, 100)) {
      const value = row[column];
      if (typeof value !== 'number') continue;
      if (isAmount && value < 0) {
        findings.push({
          layer: '结果', rule: 'G-RES-04', title: '金额字段出现负值', disposition: '提醒',
          detail: `列 ${column} 出现负值 ${value}，请确认口径是否符合预期。`, excerpt: `${column}=${value}`,
        });
        break;
      }
      if (isAmount && Math.abs(value) > guardrailMaxAmount) {
        findings.push({
          layer: '结果', rule: 'G-RES-06', title: '金额量级异常', disposition: '提醒',
          detail: `列 ${column} 取值 ${value}，超过 ${guardrailMaxAmount} 的量级上限，可能是单位（元/万元）用错或筛选条件失效。`, excerpt: `${column}=${value}`,
        });
        break;
      }
      // 客户数是天然的合理性锚点：一个子集的人数不可能超过全量客户数
      if (isCount && options.customerCount && /客户数|人数/.test(column) && value > options.customerCount) {
        findings.push({
          layer: '结果', rule: 'G-RES-07', title: '客户数超过全量客户', disposition: '提醒',
          detail: `列 ${column} 得到 ${value}，但全库只有 ${options.customerCount} 名客户，说明查询把行数当成了人数（常见于多表连接后直接 COUNT(*)）。`,
          excerpt: `${column}=${value}`,
        });
        break;
      }
      if (isRatio && (value < -1 || value > 1)) {
        findings.push({
          layer: '结果', rule: 'G-RES-05', title: '比率字段超出合理区间', disposition: '提醒',
          detail: `列 ${column} 取值 ${value} 超出 ±100%，可能是单位或口径错误。`, excerpt: `${column}=${value}`,
        });
        break;
      }
    }
  }

  return findings;
}

/** 供界面与审计展示：把一条 finding 压成一行中文。 */
export function formatGuardrailFinding(finding: GuardrailFinding) {
  return `[${finding.layer}层 ${finding.rule} ${finding.disposition}] ${finding.title}：${finding.detail}`;
}

export function describeTables(tables: string[]) {
  return tables.map((name) => `${name}（${tableLabel(name)}）`).join('、');
}