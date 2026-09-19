/**
 * AI 友好的元数据层：表定义、指标口径与业务术语。
 *
 * 对应赛题的攻关任务一——「定义出 AI 友好的元数据，以及元数据的组织形式
 * （工具设计，大模型可以通过工具获取有效的上下文）」。这里只做数据的定义，
 * 组织形式（工具）在 harness/tools 里注册，模型通过工具按需取用，而不是把
 * 全部元数据一次性塞进提示词。
 */
import { analyticsTables, type TableDef } from './schema';

export type MetricDef = {
  name: string;
  label: string;
  /** 业务口径说明，模型据此判断该指标能不能回答用户的问题 */
  definition: string;
  unit: '人' | '元' | '笔' | '个' | '百分比' | '无';
  /** 依赖的表，用于回答「跨主题域」类问题时的表选择 */
  tables: string[];
  /** 参考 SQL 片段：模型可参考，但必须通过安全围栏校验 */
  sqlHint: string;
};

export const analyticsMetrics: MetricDef[] = [
  {
    name: 'customer_count', label: '客户数', unit: '人', tables: ['cust_info'],
    definition: '满足筛选条件的客户去重计数。', sqlHint: 'SELECT COUNT(DISTINCT cust_id) FROM cust_info',
  },
  {
    name: 'total_asset', label: '总资产', unit: '元', tables: ['cust_asset'],
    definition: '客户总资产合计，取最新统计日。', sqlHint: 'SELECT SUM(total_asset) FROM cust_asset WHERE stat_date = (SELECT MAX(stat_date) FROM cust_asset)',
  },
  {
    name: 'avg_daily_asset', label: '日均资产', unit: '元', tables: ['cust_asset'],
    definition: '近 30 日日均资产合计，用于衡量稳定的资产贡献而非时点值。', sqlHint: 'SELECT SUM(daily_avg_asset) FROM cust_asset',
  },
  {
    name: 'per_customer_asset', label: '人均资产', unit: '元', tables: ['cust_asset', 'cust_info'],
    definition: '总资产除以客户数，用于比较不同客群的资产厚度。', sqlHint: 'SELECT SUM(a.total_asset) / COUNT(DISTINCT a.cust_id) FROM cust_asset a',
  },
  {
    name: 'holding_value', label: '持仓市值', unit: '元', tables: ['cust_holding'],
    definition: '客户持仓市值合计。', sqlHint: 'SELECT SUM(market_value) FROM cust_holding',
  },
  {
    name: 'holding_count', label: '持仓笔数', unit: '笔', tables: ['cust_holding'],
    definition: '持仓记录条数，反映客户持有的产品只数。', sqlHint: 'SELECT COUNT(*) FROM cust_holding',
  },
  {
    name: 'holdings_per_customer', label: '客均持仓只数', unit: '个', tables: ['cust_holding'],
    definition: '持仓笔数除以客户数，衡量客户的配置分散度。', sqlHint: 'SELECT CAST(COUNT(*) AS REAL) / COUNT(DISTINCT cust_id) FROM cust_holding',
  },
  {
    name: 'trade_count_90d', label: '近 90 日交易笔数', unit: '笔', tables: ['cust_trade'],
    definition: '近 90 日内发生的交易笔数，是活跃度的直接口径。', sqlHint: "SELECT COUNT(*) FROM cust_trade WHERE trade_date >= date('2026-09-18', '-90 day')",
  },
  {
    name: 'trade_amount_90d', label: '近 90 日交易金额', unit: '元', tables: ['cust_trade'],
    definition: '近 90 日内交易金额合计。', sqlHint: "SELECT SUM(trade_amount) FROM cust_trade WHERE trade_date >= date('2026-09-18', '-90 day')",
  },
  {
    name: 'net_inflow_90d', label: '近 90 日净流入', unit: '元', tables: ['cust_cashflow'],
    definition: '流入金额减流出金额。为负表示客户在净流出资金，是流失的前置信号。',
    sqlHint: "SELECT SUM(CASE WHEN flow_type = '流入' THEN amount ELSE -amount END) FROM cust_cashflow WHERE flow_date >= date('2026-09-18', '-90 day')",
  },
  {
    name: 'outflow_amount_90d', label: '近 90 日流出金额', unit: '元', tables: ['cust_cashflow'],
    definition: '近 90 日资金流出金额合计。', sqlHint: "SELECT SUM(amount) FROM cust_cashflow WHERE flow_type = '流出' AND flow_date >= date('2026-09-18', '-90 day')",
  },
  {
    name: 'profit_ratio_avg', label: '平均持仓收益率', unit: '百分比', tables: ['cust_holding'],
    definition: '持仓收益率的平均值，负数表示整体处于浮亏。', sqlHint: 'SELECT AVG(profit_ratio) FROM cust_holding',
  },
  {
    name: 'avg_age', label: '平均年龄', unit: '无', tables: ['cust_info'],
    definition: '客户年龄的平均值。', sqlHint: 'SELECT AVG(age) FROM cust_info',
  },
  {
    name: 'holding_cost', label: '持仓成本', unit: '元', tables: ['cust_holding'],
    definition: '持仓成本的合计值，与持仓市值对比可看整体浮盈浮亏。', sqlHint: 'SELECT SUM(cost_value) FROM cust_holding',
  },
  {
    name: 'holding_count_all', label: '持仓笔数', unit: '笔', tables: ['cust_holding'],
    definition: '持仓记录总数（不限时间）。', sqlHint: 'SELECT COUNT(*) FROM cust_holding',
  },
  {
    name: 'profit_ratio', label: '持仓收益率', unit: '百分比', tables: ['cust_holding'],
    definition: '持仓收益率的平均值口径。', sqlHint: 'SELECT AVG(profit_ratio) FROM cust_holding',
  },
  {
    name: 'net_inflow', label: '净流入', unit: '元', tables: ['cust_cashflow'],
    definition: '流入金额减流出金额，指定时间窗口时只统计窗口内。', sqlHint: "SELECT SUM(CASE WHEN flow_type = '流入' THEN amount ELSE -amount END) FROM cust_cashflow",
  },
  {
    name: 'trade_amount', label: '交易金额', unit: '元', tables: ['cust_trade'],
    definition: '交易金额合计（不限时间）。', sqlHint: 'SELECT SUM(trade_amount) FROM cust_trade',
  },
  {
    name: 'trade_count_all', label: '交易笔数', unit: '笔', tables: ['cust_trade'],
    definition: '交易记录总数（不限时间）。', sqlHint: 'SELECT COUNT(*) FROM cust_trade',
  },
  {
    name: 'flow_count', label: '流水条数', unit: '笔', tables: ['cust_cashflow'],
    definition: '资金流水记录条数。', sqlHint: 'SELECT COUNT(*) FROM cust_cashflow',
  },
  {
    name: 'product_count', label: '产品数', unit: '个', tables: ['prod_info'],
    definition: '在售产品只数。', sqlHint: 'SELECT COUNT(*) FROM prod_info',
  },
  {
    name: 'manager_count', label: '客户经理数', unit: '人', tables: ['mgr_info'],
    definition: '客户经理人数。', sqlHint: 'SELECT COUNT(DISTINCT mgr_id) FROM mgr_info',
  },
  {
    name: 'trade_count_180d', label: '近 180 日交易笔数', unit: '笔', tables: ['cust_trade'],
    definition: '近 180 日内发生的交易笔数。', sqlHint: `SELECT COUNT(*) FROM cust_trade WHERE trade_date >= date('2026-09-18', '-180 day')`,
  },
  {
    name: 'net_inflow_180d', label: '近 180 日净流入', unit: '元', tables: ['cust_cashflow'],
    definition: '近 180 日流入金额减流出金额。', sqlHint: `SELECT SUM(CASE WHEN flow_type = '流入' THEN amount ELSE -amount END) FROM cust_cashflow WHERE flow_date >= date('2026-09-18', '-180 day')`,
  },
  {
    name: 'active_customer_count', label: '活跃客户数', unit: '人', tables: ['cust_info', 'cust_trade'],
    definition: '近 90 日内有交易记录的客户数。',
    sqlHint: "SELECT COUNT(DISTINCT c.cust_id) FROM cust_info c WHERE c.cust_id IN (SELECT cust_id FROM cust_trade WHERE trade_date >= date('2026-09-18', '-90 day'))",
  },
];

export type GlossaryTerm = { term: string; definition: string; relatedTables: string[] };

/** 业务术语：用户用业务语言提问，模型据此翻译成字段与条件。 */
export const analyticsGlossary: GlossaryTerm[] = [
  { term: '高净值客户', definition: '总资产不低于 1000 万元的客户，与客户信息表的客群标签口径一致。', relatedTables: ['cust_asset', 'cust_info'] },
  { term: '活跃客户', definition: '近 90 日内发生过交易的客户（按交易流水的日期派生，不是客户信息表的标签字段）。', relatedTables: ['cust_trade'] },
  { term: '沉默客户', definition: '近 90 日内既无交易也无资金流入的客户（按交易与资金流水派生）。', relatedTables: ['cust_trade', 'cust_cashflow'] },
  { term: '客群标签', definition: 'cust_info.cust_tag 只按总资产划分：不低于 1000 万元为「高净值客户」，其余为「普通客户」；活跃与沉默是派生口径，不体现在该字段里。', relatedTables: ['cust_info', 'cust_asset'] },
  { term: '流失倾向', definition: '以近 90 日净流出为负、交易频次下降、资产规模下滑综合判断的倾向。', relatedTables: ['cust_cashflow', 'cust_trade', 'cust_asset'] },
  { term: '风险承受等级', definition: '客户可承受的产品风险上限，取值 C1 至 C5，C1 最低。', relatedTables: ['cust_info', 'dim_common'] },
  { term: '产品风险等级', definition: '产品自身的风险等级，取值 R1 至 R5，R1 最低。', relatedTables: ['prod_info'] },
  { term: '适当性匹配', definition: '产品风险等级不高于客户风险承受等级时才算匹配。越级持有属于存量适当性风险。', relatedTables: ['cust_info', 'cust_holding', 'prod_info'] },
  { term: '净流入', definition: '一定期间内流入金额减去流出金额。', relatedTables: ['cust_cashflow'] },
  { term: '日均资产', definition: '近 30 日每日资产的平均值，比时点总资产更能反映稳定贡献。', relatedTables: ['cust_asset'] },
  { term: '主协办关系', definition: '客户与客户经理的服务关系中，主办承担主要服务责任，协办辅助；is_primary = 1 为主办。', relatedTables: ['service_relation'] },
];

/** 全部表定义，作为工具 metadata.tables 的返回值。 */
export function listTables(): Array<Pick<TableDef, 'name' | 'label' | 'purpose'> & { columnCount: number }> {
  return analyticsTables.map((table) => ({
    name: table.name,
    label: table.label,
    purpose: table.purpose,
    columnCount: table.columns.length,
  }));
}

/** 单表详情，作为工具 metadata.describe 的返回值。 */
export function describeTable(name: string): TableDef | null {
  return analyticsTables.find((table) => table.name === name) ?? null;
}

/** 指标清单，作为工具 metadata.metrics 的返回值。 */
export function listMetrics(keyword?: string): MetricDef[] {
  if (!keyword) return analyticsMetrics;
  const needle = keyword.trim().toLowerCase();
  return analyticsMetrics.filter((metric) =>
    metric.label.includes(keyword) || metric.name.includes(needle) || metric.definition.includes(keyword));
}

/** 术语查询，作为工具 metadata.glossary 的返回值。 */
export function lookupGlossary(term?: string): GlossaryTerm[] {
  if (!term) return analyticsGlossary;
  return analyticsGlossary.filter((item) => item.term.includes(term) || item.definition.includes(term));
}

/**
 * 供模型使用的元数据摘要：把表、指标、术语拼成一段紧凑的上下文。
 * 只保留模型生成 SQL 必需的字段，避免提示词过长。
 */
export function metadataPromptContext() {
  const tables = analyticsTables.map((table) =>
    `${table.name}（${table.label}）：${table.columns.map((column) => `${column.name}${column.label ? ' ' + column.label : ''}`).join('、')}`,
  );
  const metrics = analyticsMetrics.map((metric) => `${metric.label}（${metric.name}，单位${metric.unit}）：${metric.definition}`);
  const glossary = analyticsGlossary.map((item) => `${item.term}：${item.definition}`);
  return [
    '可用数据表（表名（中文名）：列名 中文名）：',
    ...tables.map((line) => '  ' + line),
    '',
    '指标口径：',
    ...metrics.map((line) => '  ' + line),
    '',
    '业务术语：',
    ...glossary.map((line) => '  ' + line),
  ].join('\n');
}
