/**
 * 客户营销取数 Agent。
 *
 * 两条路径共用同一条执行链路（安全围栏 → 执行 → 结果校验），区别只在「谁来写这条 SQL」：
 *   模型路径——模型读元数据上下文后产出 SQL；
 *   规则路径——无密钥或模型不可用时，用确定性规则把问题翻译成 SQL。
 * 因此模型不是绕过围栏的捷径：它写出来的 SQL 同样要过三层校验，被拦下则降级到规则路径。
 */
import { chatJson, errorCodeOf, type ModelConfig } from '../model/adapter';
import { metadataPromptContext } from './metadata';
import { inspectMetrics, inspectResult, inspectSql, type GuardrailFinding } from './guardrail';
import { ensureAnalyticsData } from './seed';
import { planAnalyticsQuery } from './planner';

export type AskMode = 'llm' | 'rule' | 'degraded';

export type AskAgentResult = {
  question: string;
  mode: AskMode;
  model: string | null;
  sql: string;
  guardrail: { passed: boolean; findings: GuardrailFinding[]; tables: string[] };
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  explanation: string;
  answer: string;
  /** 本次引用到的指标名称（模型声明或规则规划得到），供审计核对口径 */
  metrics: string[];
  latencyMs: number;
  notes: string[];
  /** 模型路径被围栏拦下或调用失败时的原因 */
  fallbackReason: string | null;
};

export type D1Like = {
  prepare: (sql: string) => { bind: (...values: unknown[]) => { run: () => Promise<unknown>; all: <T>() => Promise<{ results: T[] }> }; run: () => Promise<unknown>; all: <T>() => Promise<{ results: T[] }>; first: () => Promise<unknown> };
  batch: (statements: unknown[]) => Promise<unknown>;
};

const querySystem = `你是券商客户营销数据平台的取数助手。请把用户的问题翻译成一条只读的 SQLite 查询。

要求：
1. 只返回 JSON：{"sql": string, "tables": string[], "metrics": string[], "explanation": string}
2. sql 必须是单条 SELECT 或 WITH 查询，禁止任何写操作，必须带 LIMIT（不超过 1000）。
3. 表名与列名只能取自下面给出的元数据，不得臆造字段；列名写错会被安全围栏拦截。
4. explanation 用一句中文说明这条查询在算什么，不超过 60 字。
5. 需要理解业务术语时，参考元数据里的术语定义（例如「高净值客户」「活跃客户」的口径）。

可用元数据：
`;

/**
 * 规则路径：把常见问题规划成一条受控 SQL（实现在 planner.ts，由元数据注册表驱动）。
 * 识别不到指标或维度时返回 null，由上层明确提示「换一种问法」，不做猜测。
 */
export function buildRuleSql(question: string) {
  const planned = planAnalyticsQuery(question);
  if (!planned) return null;
  return { sql: planned.sql, tables: planned.tables, metrics: planned.metrics, explanation: planned.explanation };
}

function validateModelSql(value: unknown) {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { sql?: unknown; tables?: unknown; metrics?: unknown; explanation?: unknown };
  if (typeof record.sql !== 'string' || record.sql.trim().length === 0) return null;
  const tables = Array.isArray(record.tables) ? record.tables.filter((item): item is string => typeof item === 'string') : [];
  const metrics = Array.isArray(record.metrics) ? record.metrics.filter((item): item is string => typeof item === 'string') : [];
  const explanation = typeof record.explanation === 'string' ? record.explanation.slice(0, 120) : '';
  return { sql: record.sql.trim().slice(0, 2000), tables, metrics, explanation };
}

function formatRows(columns: string[], rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return '查询语法正确，但没有符合条件的数据。';
  if (rows.length === 1 && columns.length <= 3) {
    return columns.map((column) => `${column} ${fmtValue(rows[0][column])}`).join('，');
  }
  return `共 ${rows.length} 行，字段为 ${columns.join('、')}。`;
}

/**
 * 全库客户数：结果层判断「客户数是否超过全量」的锚点。
 * 不做模块级缓存——同一个进程里可能先后连到不同规模的库（测试与多环境），
 * 缓存会把上一套数据的锚点用到下一套上，报出假的「客户数超过全量」。
 */
async function totalCustomerCount(db: D1Like) {
  const row = (await db.prepare('SELECT COUNT(*) AS n FROM cust_info').first()) as { n?: number } | null;
  return typeof row?.n === 'number' ? row.n : 0;
}

function fmtValue(value: unknown) {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4);
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

/**
 * 执行一次取数问答。
 * 无论走模型还是规则，SQL 都必须通过安全围栏；模型路径被拦下时自动降级到规则路径重试一次。
 */
export async function askAnalytics(
  db: D1Like,
  question: string,
  config: ModelConfig | null,
): Promise<AskAgentResult> {
  const startedAt = Date.now();
  const notes: string[] = [];
  await ensureAnalyticsData(db);

  let mode: AskMode = config ? 'llm' : 'rule';
  let model: string | null = config?.model ?? null;
  let sql: string | null = null;
  let tables: string[] = [];
  let explanation = '';
  let declaredMetrics: string[] = [];
  let guardrailPassed = true;
  let guardrailFindings: GuardrailFinding[] = [];
  let fallbackReason: string | null = null;

  if (config) {
    try {
      const result = await chatJson({
        config,
        system: querySystem + metadataPromptContext(),
        user: `用户问题：${question}`,
        validate: validateModelSql,
        maxOutputTokens: 700,
      });
      model = result.model;
      sql = result.data.sql;
      tables = result.data.tables;
      declaredMetrics = result.data.metrics;
      explanation = result.data.explanation;
      notes.push(`模型生成 SQL，用时 ${result.latencyMs} 毫秒。`);
    } catch (error) {
      fallbackReason = `模型调用失败（${errorCodeOf(error) ?? '未知错误'}），已降级为规则取数。`;
      notes.push(fallbackReason);
      mode = 'degraded';
      sql = null;
    }
  } else {
    fallbackReason = '未配置模型密钥，使用规则取数。';
    notes.push(fallbackReason);
  }

  // 模型写了 SQL 也要过围栏；被拦下则丢弃并降级
  if (sql) {
    const check = inspectSql(sql);
    // 指标合法性：模型声明的指标必须已登记，未登记一律拦截（这是「指标合法性验证」的落点）
    const metricFindings = inspectMetrics(declaredMetrics);
    guardrailFindings = [...check.findings, ...metricFindings];
    guardrailPassed = check.passed && !metricFindings.some((finding) => finding.disposition === '拦截');
    if (guardrailPassed) {
      sql = check.normalizedSql;
      tables = check.tables.length > 0 ? check.tables : tables;
    } else {
      const blocked = guardrailFindings.filter((finding) => finding.disposition === '拦截');
      fallbackReason = `模型生成的 SQL 未通过安全围栏（${blocked.map((finding) => finding.rule).join('、')}），已降级为规则取数。`;
      notes.push(fallbackReason);
      mode = 'degraded';
      sql = null;
    }
  }

  // 规则路径
  if (!sql) {
    const rule = buildRuleSql(question);
    if (!rule) {
      return {
        question, mode, model, sql: '', guardrail: { passed: false, findings: guardrailFindings, tables: [] },
        columns: [], rows: [], rowCount: 0,
        explanation: '', answer: '', metrics: declaredMetrics,
        latencyMs: Date.now() - startedAt,
        notes: [...notes, '规则路径也无法理解这个问题。'],
        fallbackReason,
      };
    }
    sql = rule.sql;
    tables = rule.tables;
    declaredMetrics = rule.metrics ?? [];
    explanation = rule.explanation;
    const check = inspectSql(sql);
    guardrailFindings = [...guardrailFindings, ...check.findings];
    guardrailPassed = check.passed;
    sql = check.normalizedSql;
    if (!check.passed) {
      notes.push('规则生成的 SQL 也未通过围栏，已拒绝执行。');
      return {
        question, mode: 'degraded', model, sql, guardrail: { passed: false, findings: guardrailFindings, tables },
        columns: [], rows: [], rowCount: 0, explanation, answer: '', metrics: declaredMetrics,
        latencyMs: Date.now() - startedAt, notes, fallbackReason,
      };
    }
  }

  // 执行
  let rows: Array<Record<string, unknown>> = [];
  let columns: string[] = [];
  try {
    const outcome = await db.prepare(sql).all<Record<string, unknown>>();
    rows = outcome.results ?? [];
    columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  } catch (error) {
    notes.push(`执行失败：${error instanceof Error ? error.message : '未知错误'}`);
    return {
      question, mode: 'degraded', model, sql, guardrail: { passed: guardrailPassed, findings: guardrailFindings, tables },
      columns: [], rows: [], rowCount: 0, explanation, answer: '', metrics: declaredMetrics,
      latencyMs: Date.now() - startedAt, notes, fallbackReason,
    };
  }

  // 结果层校验：把全库客户数作为合理性锚点传进去
  const resultFindings = inspectResult(columns, rows, { customerCount: await totalCustomerCount(db) });
  guardrailFindings = [...guardrailFindings, ...resultFindings];

  const answer = formatRows(columns, rows);
  return {
    question, mode, model, sql,
    guardrail: { passed: guardrailPassed, findings: guardrailFindings, tables },
    columns, rows: rows.slice(0, 200), rowCount: rows.length,
    explanation,
    answer,
    metrics: declaredMetrics,
    latencyMs: Date.now() - startedAt,
    notes,
    fallbackReason,
  };
}
