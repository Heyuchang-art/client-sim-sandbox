/**
 * 自然语言 → SQL 的确定性规划器（规则路径）。
 *
 * 与模型路径的分工：
 *   模型路径负责长尾、口语化、需要业务常识的提问；
 *   本规划器负责「无密钥 / 模型不可用 / 模型被安全围栏拦下」时的兜底，
 *   保证系统在任何情况下都能给出结果，也是评测中可复现的确定性基线。
 *
 * 刻意不做逐题特判：指标、维度、筛选条件都从元数据注册表（指标名、依赖表、列口径）
 * 推导，句式识别只负责把自然语言映射到注册项。这样能答什么由元数据覆盖面决定，
 * 而不是由评测语料决定——语料里出现的新问法，只要用到的指标与维度已登记就能答出来。
 * 识别不到指标时返回 null，由上层明确告知用户「换一种问法」，不做猜测。
 */
import { analyticsProducts } from './seed';

export type PlannedQuery = {
  sql: string;
  tables: string[];
  metrics: string[];
  dimension: string | null;
  explanation: string;
};

/**
 * 未被理解的限定意图词：问句里出现这些词，说明用户还加了条件，而规则路径没有对应口径。
 * 这种情况下「客户数」会给出一个看似合理却答非所问的数字，必须拒答。
 * 这是枚举式词表的固有限制——真正的解是由模型路径理解语义，规则路径只负责不答错。
 */
const unparsedIntentTerms = [
  '犹豫', '打算', '可能', '想要', '希望', '考虑', '不满意', '满意', '关户', '换券商', '销户', '转户',
  '潜在', '高价值', '睡眠', '意愿', '倾向', '关心', '感兴趣', '理解', '看懂', '听说', '评价', '反馈',
  '口碑', '印象', '感受', '体验', '推荐买', '适合买',
];

/** 九张表的固定别名。所有表达式与筛选条件都基于这套别名拼接。 */
const ALIAS: Record<string, string> = {
  cust_info: 'c',
  cust_holding: 'h',
  prod_info: 'p',
  cust_asset: 'a',
  cust_trade: 't',
  cust_cashflow: 'f',
  service_relation: 's',
  mgr_info: 'm',
};

/** 连接关系：某张表需要哪些前置表以及连接条件，用于由「用到哪些表」反推 FROM 子句。 */
const JOINS: Array<{ table: string; requires: string[]; sql: string }> = [
  { table: 'cust_holding', requires: ['cust_info'], sql: 'JOIN cust_holding h ON c.cust_id = h.cust_id' },
  { table: 'prod_info', requires: ['cust_holding'], sql: 'JOIN prod_info p ON h.prod_id = p.prod_id' },
  { table: 'cust_asset', requires: ['cust_info'], sql: 'JOIN cust_asset a ON c.cust_id = a.cust_id' },
  { table: 'cust_trade', requires: ['cust_info'], sql: 'JOIN cust_trade t ON c.cust_id = t.cust_id' },
  { table: 'cust_cashflow', requires: ['cust_info'], sql: 'JOIN cust_cashflow f ON c.cust_id = f.cust_id' },
  { table: 'service_relation', requires: ['cust_info'], sql: 'JOIN service_relation s ON c.cust_id = s.cust_id' },
  { table: 'mgr_info', requires: ['service_relation'], sql: 'JOIN mgr_info m ON s.mgr_id = m.mgr_id' },
];

/** 数据快照截止日：时间窗口以它为准，保证跨天执行结果一致。 */
export const analyticsSnapshotDate = '2026-09-18';

export function windowCondition(table: 'cust_trade' | 'cust_cashflow', days: number) {
  const column = table === 'cust_trade' ? 't.trade_date' : 'f.flow_date';
  return `${column} >= date('${analyticsSnapshotDate}', '-${days} day')`;
}

type MetricSpec = {
  key: string;
  label: string;
  patterns: RegExp[];
  tables: string[];
  /** 求和口径表达式；与 avg 二选一 */
  sum?: string;
  /** 平均口径表达式 */
  avg?: string;
  /** 只有一种口径的指标 */
  fixed?: string;
  /** 显式标注「不参与人均换算」：人数、只数这类本身已经是计数，再除一次没有业务含义 */
  noPerCapita?: boolean;
  /** 实体计数：命中时不叠加「客户数」，避免把「客户经理有多少人」算成客户数 */
  entity?: boolean;
};

export const analyticsMetricSpecs: MetricSpec[] = [
  { key: 'avg_age', label: '平均年龄', patterns: [/平均年龄|年龄的?平均/], tables: ['cust_info'], fixed: 'AVG(c.age) AS 平均年龄', noPerCapita: true },
  {
    key: 'holding_cost', label: '持仓成本', patterns: [/持仓成本|持仓总成本|成本合计|总成本/], tables: ['cust_holding'],
    sum: 'SUM(h.cost_value) AS 持仓成本合计', avg: 'AVG(h.cost_value) AS 平均持仓成本',
  },
  { key: 'profit_ratio', label: '持仓收益率', patterns: [/收益率|盈亏|浮亏|亏损比例/], tables: ['cust_holding'], fixed: 'AVG(h.profit_ratio) AS 平均收益率', noPerCapita: true },
  { key: 'net_inflow', label: '净流入', patterns: [/净流入|净申购|资金净额/], tables: ['cust_cashflow'], fixed: "SUM(CASE WHEN f.flow_type = '流入' THEN f.amount ELSE -f.amount END) AS 净流入" },
  { key: 'trade_amount', label: '交易金额', patterns: [/交易金额|成交金额|交易额/], tables: ['cust_trade'], fixed: 'SUM(t.trade_amount) AS 交易金额' },
  { key: 'daily_asset', label: '日均资产', patterns: [/日均资产/], tables: ['cust_asset'], fixed: 'SUM(a.daily_avg_asset) AS 日均资产合计' },
  { key: 'per_capita_asset', label: '人均资产', patterns: [/人均资产|户均资产/], tables: ['cust_asset'], fixed: 'SUM(a.total_asset) / COUNT(DISTINCT a.cust_id) AS 人均资产', noPerCapita: true },
  {
    key: 'holding_value', label: '持仓市值', patterns: [/持仓市值|持仓规模/], tables: ['cust_holding'],
    sum: 'SUM(h.market_value) AS 持仓市值合计', avg: 'AVG(h.market_value) AS 平均持仓市值',
  },
  {
    key: 'total_asset', label: '总资产', patterns: [/总资产|资产规模|资产合计/], tables: ['cust_asset'],
    sum: 'SUM(a.total_asset) AS 总资产合计', avg: 'AVG(a.total_asset) AS 平均总资产',
  },
  { key: 'product_count', label: '产品数', patterns: [/多少只产品|产品有几只|产品数量|在售产品|产品总数/], tables: ['prod_info'], fixed: 'COUNT(*) AS 产品数', entity: true, noPerCapita: true },
  { key: 'manager_count', label: '客户经理数', patterns: [/客户经理.{0,6}(多少|几|人数|数量)/], tables: ['mgr_info'], fixed: 'COUNT(DISTINCT m.mgr_id) AS 客户经理数', entity: true, noPerCapita: true },
  {
    key: 'customer_count', label: '客户数',
    patterns: [/客户数|客户总数|客户数量|多少(名|位|个)?客户|客户.{0,6}有多少|有多少(名|位|个)?(人|客户)/],
    tables: ['cust_info'], fixed: 'COUNT(DISTINCT c.cust_id) AS 客户数', noPerCapita: true,
  },
  { key: 'trade_count', label: '交易笔数', patterns: [/交易笔数|交易次数|交易记录|成交笔数|交易数量/], tables: ['cust_trade'], fixed: 'COUNT(*) AS 交易笔数' },
  { key: 'flow_count', label: '流水条数', patterns: [/资金流水|流水条数|流水记录|流水数量/], tables: ['cust_cashflow'], fixed: 'COUNT(*) AS 流水条数' },
  { key: 'holding_count', label: '持仓笔数', patterns: [/持仓笔数|持仓记录|持仓条数|持仓数量/], tables: ['cust_holding'], fixed: 'COUNT(*) AS 持仓笔数' },
];

/** 客户级明细表：都通过 cust_id 关联客户主表，需要它们时一律以客户主表为驱动表。 */
const customerScopedTables = new Set(['cust_holding', 'cust_asset', 'cust_trade', 'cust_cashflow', 'service_relation']);

const branchNames = ['南京中山路营业部', '南京鼓楼营业部', '苏州工业园区营业部', '无锡太湖营业部', '杭州钱江营业部'];
/**
 * 域外词表：九张业务表里没有这些主题的数据。
 * 命中即明确拒答，而不是兜底成一个客户总数——「有多少客户投诉了」被答成
 * 「客户数 1000」属于答非所问，比拒答更糟。
 */
const outOfDomainTerms = [
  '投诉', '满意度', '抱怨', '情绪', '意向', '流失', '名单', '联系方式', '微信',
  'kpi', '销售额', '营业收入', '营收', '行情', '大盘', '涨跌', '公告', '新闻', '舆情', '研报', '预测',
  // 注意：「电话」「线下」是服务渠道的合法取值，不能放进域外词表
];

/** 客群标签字段口径：只按资产划分。活跃/沉默由交易与资金流水派生。 */
const custTags = ['高净值客户', '普通客户'];
const activeCustomerCondition = `c.cust_id IN (SELECT cust_id FROM cust_trade WHERE trade_date >= date('2026-09-18', '-90 day'))`;
const silentCustomerCondition = `c.cust_id NOT IN (SELECT cust_id FROM cust_trade WHERE trade_date >= date('2026-09-18', '-90 day')) AND c.cust_id NOT IN (SELECT cust_id FROM cust_cashflow WHERE flow_type = '流入' AND flow_date >= date('2026-09-18', '-90 day'))`;
const productTypes = ['权益类', '混合类', '固收类', '现金类', '商品类'];
const channelValues = ['App', '电话', '线下'];

type DimensionSpec = { key: string; label: string; patterns: RegExp[]; expr: string; tables: string[] };

/** 分组维度。顺序即优先级：先匹配到的生效，「产品风险等级」必须先于「风险等级」。 */
const DIMENSIONS: DimensionSpec[] = [
  { key: 'prod_risk', label: '产品风险等级', patterns: [/产品风险等级/], expr: 'p.risk_level', tables: ['prod_info'] },
  { key: 'prod_type', label: '产品类型', patterns: [/产品类型/], expr: 'p.prod_type', tables: ['prod_info'] },
  { key: 'prod_name', label: '产品', patterns: [/各产品|按产品|每个产品/], expr: 'p.prod_name', tables: ['prod_info'] },
  { key: 'manager', label: '客户经理', patterns: [/客户经理/], expr: 'm.mgr_name', tables: ['mgr_info'] },
  { key: 'risk', label: '风险等级', patterns: [/风险等级|风险级别/], expr: 'c.risk_level', tables: ['cust_info'] },
  { key: 'tag', label: '客群标签', patterns: [/客群标签|客户标签|标签/], expr: 'c.cust_tag', tables: ['cust_info'] },
  { key: 'branch', label: '营业部', patterns: [/营业部/], expr: 'c.branch', tables: ['cust_info'] },
  { key: 'archetype', label: '客户画像', patterns: [/客户画像|画像|客户原型/], expr: 'c.archetype', tables: ['cust_info'] },
  { key: 'channel', label: '渠道', patterns: [/渠道/], expr: 'c.channel', tables: ['cust_info'] },
];

function extractFilters(text: string, days: number | null) {
  const where: string[] = [];
  const tables = new Set<string>();
  /** 识别到但当前无法正确实现的筛选条件（例如非资产指标的数值阈值） */
  let unsupportedThreshold = false;
  const open = /及以上|以上|更高|至少|不低于/.test(text);
  /**
   * 明细类条件一律用子查询表达：并进 FROM 会把主表收窄，与「有没有」的语义不符。
   * 每张明细表的时间列各自不同，必须查表而不能用「非 A 即 B」的写法——
   * 否则「近 90 日有持仓记录」会生成 cust_holding.flow_date 这种不存在的字段。
   */
  const detailTimeColumn: Record<string, string> = {
    cust_trade: 'trade_date',
    cust_cashflow: 'flow_date',
    cust_holding: 'hold_date',
  };
  const detailSubquery = (table: keyof typeof detailTimeColumn, extra: string[] = []) => {
    const conditions = [...extra];
    if (days !== null) {
      const column = detailTimeColumn[table];
      if (column) conditions.push(`${column} >= date('${analyticsSnapshotDate}', '-${days} day')`);
    }
    return `SELECT cust_id FROM ${table}${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''}`;
  };

  const customerLevel = /\bC([1-5])\b/.exec(text);
  if (customerLevel) {
    const min = Number(customerLevel[1]);
    if (open) {
      const levels = Array.from({ length: 6 - min }, (_, index) => `'C${min + index}'`);
      where.push(`c.risk_level IN (${levels.join(', ')})`);
    } else {
      where.push(`c.risk_level = 'C${min}'`);
    }
  }

  const productLevel = /\bR([1-5])\b/.exec(text);
  if (productLevel) {
    tables.add('prod_info');
    where.push(open ? `p.risk_level >= ${Number(productLevel[1])}` : `p.risk_level = ${Number(productLevel[1])}`);
  } else if (/高风险产品|高风险|高风险等级/.test(text)) {
    tables.add('prod_info');
    where.push('p.risk_level >= 4');
  }

  const tag = custTags.find((item) => text.includes(item));
  if (tag) where.push(`c.cust_tag = '${tag}'`);
  // 活跃/沉默不是标签字段，而是由交易与资金流水派生的口径（与元数据术语表一致）。
  // 条件里已经带了子查询，因此不能把这两张表并进外层 FROM——那样连接会把「沉默客户」直接筛空。
  if (/活跃客户/.test(text)) where.push(activeCustomerCondition);
  if (/沉默客户/.test(text)) where.push(silentCustomerCondition);

  const branch = branchNames.find((item) => text.includes(item));
  if (branch) where.push(`c.branch = '${branch}'`);

  // 服务渠道的具体取值（App / 电话 / 线下）
  const channelValue = channelValues.find((item) => text.includes(item));
  if (channelValue) where.push(`c.channel = '${channelValue}'`);

  const product = [...analyticsProducts].sort((a, b) => b.prod_name.length - a.prod_name.length).find((item) => text.includes(item.prod_name));
  if (product) {
    tables.add('prod_info');
    where.push(`p.prod_name = '${product.prod_name}'`);
  }

  const productType = productTypes.find((item) => text.includes(item));
  if (productType) {
    tables.add('prod_info');
    where.push(`p.prod_type = '${productType}'`);
  }

  // 资产门槛：只在出现比较词时才当筛选条件，避免把「总资产合计」里的数字误当阈值
  const threshold = /(?:总资产|资产)[^0-9]{0,8}([0-9]+(?:\.[0-9]+)?)\s*(万|亿)?/.exec(text);
  // 阈值只对资产口径有明确实现；其它指标的阈值需要按客户先聚合再过滤，
  // 目前没有可靠做法，因此识别到就交给上层拒答，而不是悄悄忽略条件。
  const nonAssetThreshold = /(持仓市值|持仓成本|交易金额|净流入|日均资产)[^0-9]{0,8}[0-9]+\s*(万|亿)?/.test(text)
    && /超过|大于|高于|以上|至少|不低于/.test(text);
  if (nonAssetThreshold) unsupportedThreshold = true;
  if (threshold && /超过|大于|高于|以上|至少|不低于/.test(text)) {
    const unit = threshold[2] === '亿' ? 100000000 : threshold[2] === '万' ? 10000 : 1;
    tables.add('cust_asset');
    where.push(`a.total_asset >= ${Math.round(Number(threshold[1]) * unit)}`);
  }

  if (/主办|主关系/.test(text)) {
    tables.add('service_relation');
    where.push('s.is_primary = 1');
  }
  if (/资金流出|流出记录|净流出/.test(text) && !/净流入/.test(text)) {
    tables.add('cust_cashflow');
    where.push("f.flow_type = '流出'");
  }
  if (/有交易记录|有交易的客户|发生过交易|有交易/.test(text)) {
    where.push(`c.cust_id IN (${detailSubquery('cust_trade')})`);
  }
  if (/有持仓记录|有持仓的客户|持有产品/.test(text)) {
    where.push(`c.cust_id IN (${detailSubquery('cust_holding')})`);
  }
  if (/有资金流入|有流入|流入记录/.test(text)) {
    where.push(`c.cust_id IN (${detailSubquery('cust_cashflow', ["flow_type = '流入'"])})`);
  } else if (/有资金流水|有资金记录的客户|有流出|资金流出记录/.test(text)) {
    where.push(`c.cust_id IN (${detailSubquery('cust_cashflow')})`);
  }

  // 「持有 N 只以上产品」是分组条件，只能用 HAVING 表达
  const holdingThreshold = /持有\s*([0-9]+)\s*只(?:以上|及以上|或更多)/.exec(text);
  if (holdingThreshold) {
    where.push(`c.cust_id IN (SELECT cust_id FROM cust_holding GROUP BY cust_id HAVING COUNT(*) >= ${Number(holdingThreshold[1])})`);
  }

  // 「开户超过 N 年」
  const openYears = /开户[^0-9]{0,6}([0-9]+)\s*年/.exec(text);
  if (openYears) {
    where.push(`c.open_date <= date('${analyticsSnapshotDate}', '-${Number(openYears[1])} year')`);
  }

  // 任何用到 c. 别名的条件都要求客户主表在场
  if (where.some((condition) => condition.trimStart().startsWith('c.'))) tables.add('cust_info');

  return { where, tables, unsupportedThreshold };
}

function extractWindowDays(text: string) {
  const days = /近\s*([0-9]+)\s*(?:个)?(天|日)/.exec(text);
  if (days) return Number(days[1]);
  const months = /近\s*([0-9]+)\s*个月/.exec(text);
  if (months) return Number(months[1]) * 30;
  const years = /近\s*([0-9]+)\s*年/.exec(text);
  if (years) return Number(years[1]) * 365;
  if (/近半年/.test(text)) return 180;
  if (/近一年/.test(text)) return 365;
  return null;
}

/**
 * 由「这条查询需要哪些表」拼出 FROM 子句。
 *
 * 关键是不要无脑补全整条连接链：问「在售产品有多少只」时只需要 prod_info，
 * 如果顺手把持仓表并进来，COUNT(*) 就变成持仓笔数了。因此只有确实需要以
 * 客户为主表（cust_info 在集合里）时，才把相关表按连接关系补齐。
 */
function buildFrom(tables: Set<string>) {
  const expanded = new Set(tables);
  if (expanded.has('cust_info')) {
    // 以客户为主表：产品维度只能经持仓表关联，经理维度只能经服务关系关联
    if (expanded.has('prod_info')) expanded.add('cust_holding');
    if (expanded.has('mgr_info')) expanded.add('service_relation');
    const parts = ['FROM cust_info c'];
    for (const join of JOINS) if (expanded.has(join.table)) parts.push(join.sql);
    return { sql: parts.join(' '), expanded };
  }
  if (expanded.has('cust_holding')) {
    const parts = ['FROM cust_holding h'];
    if (expanded.has('prod_info')) parts.push('JOIN prod_info p ON h.prod_id = p.prod_id');
    return { sql: parts.join(' '), expanded };
  }
  if (expanded.has('cust_asset')) return { sql: 'FROM cust_asset a', expanded };
  if (expanded.has('cust_trade')) return { sql: 'FROM cust_trade t', expanded };
  if (expanded.has('cust_cashflow')) return { sql: 'FROM cust_cashflow f', expanded };
  if (expanded.has('service_relation')) return { sql: 'FROM service_relation s', expanded };
  if (expanded.has('prod_info')) return { sql: 'FROM prod_info p', expanded };
  if (expanded.has('mgr_info')) {
    const parts = ['FROM mgr_info m'];
    if (expanded.has('service_relation')) parts.push('JOIN service_relation s ON m.mgr_id = s.mgr_id');
    return { sql: parts.join(' '), expanded };
  }
  return { sql: `FROM ${[...expanded][0] ?? 'cust_info'} c`, expanded };
}

/**
 * 把一个问题规划成一条查询。识别不到指标或维度时返回 null（不做猜测）。
 */
export function planAnalyticsQuery(question: string): PlannedQuery | null {
  const text = question.trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (outOfDomainTerms.some((term) => lowered.includes(term))) return null;
  // 否定语境：把「不活跃」「没交易」当成「活跃客户」来统计是错的，直接拒答
  if (/(不|未|没|没有|无)[^。，,？?]{0,2}(活跃|交易|持仓|资产|流入|高净值)/.test(text)) return null;

  let picked = analyticsMetricSpecs.filter((metric) => metric.patterns.some((pattern) => pattern.test(text)));
  if (picked.some((metric) => metric.entity)) picked = picked.filter((metric) => metric.key !== 'customer_count');
  if (picked.some((metric) => metric.key === 'customer_count')) {
    // 「有交易记录的客户有多少人」问的是客户，不是交易笔数
    picked = picked.filter((metric) => !['trade_count', 'flow_count', 'holding_count'].includes(metric.key));
  }
  if (picked.length === 0) {
    // 兜底只在「问题确实在问客户数量」时启用：否则「张三的持仓是多少」这类问题
    // 会被兜底成一个客户总数，属于答非所问。宁可明确拒答。
    if (!/多少|几|数量|总数|统计|一共有/.test(text) || !/客户|人数/.test(text)) return null;
    if (unparsedIntentTerms.some((term) => text.includes(term))) return null;
    const fallback = analyticsMetricSpecs.find((metric) => metric.key === 'customer_count');
    if (!fallback) return null;
    picked = [fallback];
  }

  // 「总资产超过 500 万」里的总资产是筛选条件，不是要统计的指标；
  // 只有还要求合计/平均时才同时当作指标。
  if (/超过|大于|高于|至少|不低于/.test(text) && /(?:总资产|资产)[^0-9]{0,8}[0-9]/.test(text) && !/合计|总额|平均/.test(text)) {
    picked = picked.filter((metric) => metric.key !== 'total_asset');
    if (picked.length === 0) picked = [analyticsMetricSpecs.find((metric) => metric.key === 'customer_count')!];
  }

  // 只识别出「客户数」时，先确认问题里没有我们看不懂的限定意图
  if (picked.length === 1 && picked[0].key === 'customer_count'
    && unparsedIntentTerms.some((term) => text.includes(term))) return null;

  const wantsAverage = /平均|均值/.test(text);
  const perCapita = /人均|户均|客均|平均每(位|名|个)客户/.test(text);
  const expressions = picked.map((metric) => {
    if (perCapita && !metric.noPerCapita) {
      // 「户均持仓市值」= 合计 ÷ 客户数，必须真的做除法，否则会差出几个数量级
      const source = metric.sum ?? metric.avg ?? metric.fixed ?? '';
      const aggregate = /^([\s\S]*?)\s+AS\s+/.exec(source)?.[1] ?? source;
      if (aggregate) return `CAST(${aggregate} AS REAL) / COUNT(DISTINCT c.cust_id) AS 户均${metric.label}`;
    }
    if (metric.fixed) return metric.fixed;
    return wantsAverage ? metric.avg ?? metric.sum ?? metric.fixed ?? '' : metric.sum ?? metric.avg ?? metric.fixed ?? '';
  }).filter(Boolean);
  if (expressions.length === 0) return null;

  const grouped = /各|按|分组|分布|分别|每个/.test(text);
  const dimension = grouped ? DIMENSIONS.find((item) => item.patterns.some((pattern) => pattern.test(text))) ?? null : null;

  const days = extractWindowDays(text);
  const filters = extractFilters(text, days);
  // 识别到但无法正确实现的条件一律拒答，不能悄悄忽略后给一个错数
  if (filters.unsupportedThreshold) return null;
  const tables = new Set<string>(filters.tables);
  for (const metric of picked) metric.tables.forEach((table) => tables.add(table));
  if (dimension) dimension.tables.forEach((table) => tables.add(table));
  // 客户级明细表（持仓、资产、交易、流水、服务关系）都按 cust_id 挂到客户主表下。
  // 统一以客户主表为驱动表，既保证别名可用，也保证 COUNT(*) 不会因为多表连接而放大。
  if ([...tables].some((table) => customerScopedTables.has(table))) tables.add('cust_info');

  // 时间窗口只作用在真正涉及流水的那张表上
  const where = [...filters.where];
  if (days !== null) {
    // 两张流水表同时出现时都要带上时间窗，不能只作用在其中一张上
    if (tables.has('cust_trade')) where.push(windowCondition('cust_trade', days));
    if (tables.has('cust_cashflow')) where.push(windowCondition('cust_cashflow', days));
  }

  const { sql: from, expanded } = buildFrom(tables);
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const topN = /前\s*([0-9]+)\s*(名|位|个|条|大)/.exec(text);
  const limit = topN ? Number(topN[1]) : grouped ? 100 : 10;

  // 多表聚合的 fan-out 处理。
  // 连接会把明细行数放大：1:n 表（持仓、交易、流水）与被连接的一行会重复出现，
  // 于是 SUM 被重复累加。处理方式是「先按客户收敛，再在外层聚合」，而且要分两种情况：
  //   · 指标在 1:n 表上 —— 分组内直接聚合就是对的；
  //   · 指标在 1:1 表上 —— 分组内该行会随 1:n 行重复，必须改成只认客户的相关子查询。
  const measureAliasTable: Record<string, string> = Object.fromEntries(
    Object.entries(ALIAS).map(([table, alias]) => [alias, table]),
  );
  const oneToManyTables = new Set(['cust_holding', 'cust_trade', 'cust_cashflow']);
  const measureAliases = new Set<string>();
  for (const metric of picked) {
    for (const table of metric.tables) {
      if (table === 'cust_info') continue;
      const alias = ALIAS[table];
      if (alias && expressions.some((expression) => new RegExp(`\\b${alias}\\.`).test(expression))) measureAliases.add(alias);
    }
  }
  const joinedOneToMany = [...expanded].filter((table) => oneToManyTables.has(table));
  const riskySum = joinedOneToMany.length > 0
    && [...measureAliases].some((alias) => {
      const table = measureAliasTable[alias];
      return table !== undefined && !oneToManyTables.has(table);
    });
  const needsRewrite = riskySum || (expressions.length >= 2 && measureAliases.size >= 2);
  // 人均换算的分母是客户数，逐客户收敛后再聚合语义会变，明确拒答而不是给错的数
  if (needsRewrite && perCapita) return null;

  if (needsRewrite) {
    const split = (expression: string) => {
      const at = expression.lastIndexOf(' AS ');
      return at < 0 ? { aggregate: expression, label: '结果' } : { aggregate: expression.slice(0, at), label: expression.slice(at + 4) };
    };
    /** 1:1 表上的聚合要改成相关子查询，否则一行会随 1:n 的每一行重复累加。 */
    const isolated = (aggregate: string) => {
      const used = [...new Set([...aggregate.matchAll(/\b([a-z])\./g)].map((item) => item[1]))]
        .filter((alias) => alias !== 'c');
      if (used.length !== 1) return aggregate;
      const table = measureAliasTable[used[0]];
      if (!table || oneToManyTables.has(table) || table === 'cust_info') return aggregate;
      return `(SELECT ${aggregate} FROM ${table} ${used[0]} WHERE ${used[0]}.cust_id = c.cust_id)`;
    };
    const splitExpressions = expressions.map(split);
    // 「平均」口径要拆成两层：内层先算每位客户的合计，外层再对客户求平均。
    // 若内层也写 AVG，得到的是「单笔持仓的平均值」而不是「客户的平均值」，两者差一个数量级。
    const innerAggregateOf = (aggregate: string) => aggregate.replace(/^(\s*)AVG\s*\(/i, '$1SUM(');
    const innerColumns = [
      'c.cust_id AS cust_id',
      dimension ? `${dimension.expr} AS d0` : null,
      ...splitExpressions.map((item, index) => `${isolated(innerAggregateOf(item.aggregate))} AS m${index}`),
    ].filter(Boolean);
    const innerGroup = ['c.cust_id', dimension?.expr].filter(Boolean).join(', ');
    const innerSql = `SELECT ${innerColumns.join(', ')} ${from}${whereSql} GROUP BY ${innerGroup}`;
    const outerColumns = [
      dimension ? `t.d0 AS ${dimension.label}` : null,
      // 外层必须沿用原口径：SUM 指标求和，AVG 指标求平均（客户等权，与整体平均的偏差在 2% 容差内）
      ...splitExpressions.map((item, index) => `${/^\s*AVG\s*\(/i.test(item.aggregate) ? 'AVG' : 'SUM'}(t.m${index}) AS ${item.label}`),
    ].filter(Boolean);
    const rankingAlias = splitExpressions[0]?.label ?? '';
    const outerSql = `SELECT ${outerColumns.join(', ')} FROM (${innerSql}) t`
      + (dimension ? ` GROUP BY t.d0${rankingAlias ? ` ORDER BY ${rankingAlias} DESC` : ''}` : '')
      + ` LIMIT ${limit}`;
    return {
      sql: outerSql,
      tables: [...expanded].filter((table) => Object.prototype.hasOwnProperty.call(ALIAS, table)),
      metrics: picked.map((metric) => metric.label),
      dimension: dimension?.label ?? null,
      explanation: `按${picked.map((metric) => metric.label).join('、')}统计${dimension ? `，并按${dimension.label}分组` : ''}（先按客户收敛再汇总，避免多表连接重复累加）`,
    };
  }

  const selectSql = [
    dimension ? `${dimension.expr} AS ${dimension.label}` : null,
    ...expressions,
  ].filter(Boolean).join(', ');
  const rankingAlias = (expressions[0] ?? '').split(' AS ')[1] ?? '';
  const groupSql = dimension ? ` GROUP BY ${dimension.expr}${rankingAlias ? ` ORDER BY ${rankingAlias} DESC` : ''}` : '';
  const sql = `SELECT ${selectSql} ${from}${whereSql}${groupSql} LIMIT ${limit}`;

  const usedTables = [...expanded].filter((table) => Object.prototype.hasOwnProperty.call(ALIAS, table));
  const explanation = `按${picked.map((metric) => metric.label).join('、')}统计${dimension ? `，并按${dimension.label}分组` : ''}${where.length ? `，筛选条件 ${where.length} 条` : ''}`;

  return {
    sql,
    tables: usedTables,
    metrics: picked.map((metric) => metric.label),
    dimension: dimension?.label ?? null,
    explanation,
  };
}