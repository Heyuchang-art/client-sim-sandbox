/**
 * 九张业务表的合成数据。
 *
 * 全部按固定种子确定性生成，重复执行结果一致；数据规模与字段严格对齐赛题给的九张表，
 * 便于在同一套 schema 上验证查询与安全围栏。真实数据到位后只需替换本模块的装载逻辑，
 * 表结构与查询链路不需要改动。
 */
import { generateCustomers, type Customer } from '../simulation';
import { analyticsDdl, analyticsIndexes } from './schema';

export const analyticsSeedReferenceDate = '2026-09-18';

/** 「高净值客户」口径：总资产不低于 1000 万元。客群标签与 glossary 共用这一阈值，避免口径两处维护。 */
export const analyticsHighNetWorthAsset = 10_000_000;

/** 与沙盘共用同一批产品名，保证取数与推演两层说的是一回事。 */
export const analyticsProducts = [
  { prod_id: 'P01', prod_name: '科技成长组合', prod_type: '权益类', risk_level: 4, volatility: 1.22, mgr_fee_rate: 0.015 },
  { prod_id: 'P02', prod_name: '量化增强产品', prod_type: '混合类', risk_level: 3, volatility: 1.04, mgr_fee_rate: 0.012 },
  { prod_id: 'P03', prod_name: '新能源主题基金', prod_type: '权益类', risk_level: 5, volatility: 1.34, mgr_fee_rate: 0.015 },
  { prod_id: 'P04', prod_name: '红利低波组合', prod_type: '权益类', risk_level: 2, volatility: 0.62, mgr_fee_rate: 0.008 },
  { prod_id: 'P05', prod_name: '沪深300指数增强', prod_type: '权益类', risk_level: 4, volatility: 1.05, mgr_fee_rate: 0.01 },
  { prod_id: 'P06', prod_name: '中证500指数基金', prod_type: '权益类', risk_level: 4, volatility: 1.18, mgr_fee_rate: 0.01 },
  { prod_id: 'P07', prod_name: '医药主题基金', prod_type: '权益类', risk_level: 5, volatility: 1.28, mgr_fee_rate: 0.015 },
  { prod_id: 'P08', prod_name: '消费精选混合', prod_type: '混合类', risk_level: 3, volatility: 0.98, mgr_fee_rate: 0.012 },
  { prod_id: 'P09', prod_name: '固收加策略', prod_type: '固收类', risk_level: 2, volatility: 0.35, mgr_fee_rate: 0.006 },
  { prod_id: 'P10', prod_name: '纯债优选', prod_type: '固收类', risk_level: 1, volatility: 0.12, mgr_fee_rate: 0.004 },
  { prod_id: 'P11', prod_name: '短债理财', prod_type: '固收类', risk_level: 1, volatility: 0.08, mgr_fee_rate: 0.003 },
  { prod_id: 'P12', prod_name: '货币增强', prod_type: '现金类', risk_level: 1, volatility: 0.03, mgr_fee_rate: 0.002 },
  { prod_id: 'P13', prod_name: '港股通精选', prod_type: '权益类', risk_level: 5, volatility: 1.31, mgr_fee_rate: 0.015 },
  { prod_id: 'P14', prod_name: '全球配置QDII', prod_type: '权益类', risk_level: 5, volatility: 1.24, mgr_fee_rate: 0.016 },
  { prod_id: 'P15', prod_name: '黄金ETF联接', prod_type: '商品类', risk_level: 3, volatility: 0.86, mgr_fee_rate: 0.005 },
  { prod_id: 'P16', prod_name: '养老目标2035', prod_type: '混合类', risk_level: 4, volatility: 0.92, mgr_fee_rate: 0.009 },
  { prod_id: 'P17', prod_name: '军工主题基金', prod_type: '权益类', risk_level: 5, volatility: 1.36, mgr_fee_rate: 0.015 },
  { prod_id: 'P18', prod_name: '银行ETF联接', prod_type: '权益类', risk_level: 3, volatility: 0.79, mgr_fee_rate: 0.005 },
  { prod_id: 'P19', prod_name: '可转债增强', prod_type: '混合类', risk_level: 3, volatility: 0.71, mgr_fee_rate: 0.008 },
  { prod_id: 'P20', prod_name: '券商收益凭证', prod_type: '固收类', risk_level: 2, volatility: 0.2, mgr_fee_rate: 0.005 },
];

const branches = ['南京中山路营业部', '南京鼓楼营业部', '苏州工业园区营业部', '无锡太湖营业部', '杭州钱江营业部'];
const channels = ['App', '电话', '线下'];
const teams = ['财富一组', '财富二组', '机构组', '线上运营组'];
const titles = ['客户经理', '高级客户经理', '资深客户经理', '投资顾问'];
const flowChannels = ['银证转账', '产品赎回', '产品申购', '分红派息'];
const size = 100000; // 建仓与交易的规模因子

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateOffset(months: number, days: number) {
  const base = new Date(`${analyticsSeedReferenceDate}T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() - months);
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString().slice(0, 10);
}

export type AnalyticsSeed = {
  cust_info: Array<Record<string, unknown>>;
  mgr_info: Array<Record<string, unknown>>;
  prod_info: Array<Record<string, unknown>>;
  service_relation: Array<Record<string, unknown>>;
  dim_common: Array<Record<string, unknown>>;
  cust_holding: Array<Record<string, unknown>>;
  cust_asset: Array<Record<string, unknown>>;
  cust_trade: Array<Record<string, unknown>>;
  cust_cashflow: Array<Record<string, unknown>>;
};

/** 生成九张表的全部行；同一 seed 必然得到同一份数据。 */
export function buildAnalyticsSeed(customerCount = 1000, seed = 20260830): AnalyticsSeed {
  const random = mulberry32(seed ^ 0x2f1a3b);
  const customers: Customer[] = generateCustomers(customerCount, seed, 0.2);

  const mgrCount = 50;
  const mgr_info = Array.from({ length: mgrCount }, (_, index) => ({
    mgr_id: `M-${String(1 + index).padStart(4, '0')}`,
    mgr_name: `${branches[index % branches.length][2]}经理${index + 1}`,
    branch: branches[index % branches.length],
    team: teams[index % teams.length],
    title: titles[index % titles.length],
    join_date: dateOffset((index % 96) + 1, index % 28),
  }));

  const cust_info: Array<Record<string, unknown>> = [];
  const service_relation: Array<Record<string, unknown>> = [];
  const cust_asset: Array<Record<string, unknown>> = [];
  const cust_holding: Array<Record<string, unknown>> = [];
  const cust_trade: Array<Record<string, unknown>> = [];
  const cust_cashflow: Array<Record<string, unknown>> = [];

  customers.forEach((customer, index) => {
    const silent = customer.archetype.includes('沉默');
    const active = customer.archetype.includes('高频') || customer.archetype.includes('进取');

    // 资产分布刻意做成长尾：多数客户是中小账户，少数高净值客户贡献主要资产规模，
    // 这样「高净值客户」才是有区分度的口径，而不是人人达标。
    const base = 2 * size + Math.pow(random(), 12) * 1600 * size;
    const holdShare = 0.45 + random() * 0.45;
    const total = Math.round(base);
    const highNetWorth = total >= analyticsHighNetWorthAsset;
    // 上游画像器只产出 C2–C5（沙盘场景无需最低风险等级），但取数侧必须五个等级齐全，
    // 否则「C1 客户有多少」这类问题永远查不到数据。这里按确定性规则把约七分之一的 C2 下移为 C1。
    const analyticsRiskLevel = customer.riskLevel === 'C2' && index % 7 === 0 ? 'C1' : customer.riskLevel;

    cust_info.push({
      cust_id: customer.id,
      cust_name: customer.name,
      gender: random() < 0.52 ? '女' : '男',
      age: 26 + Math.floor(random() * 44),
      risk_level: analyticsRiskLevel,
      open_date: dateOffset((index % 120) + 6, index % 27),
      branch: branches[index % branches.length],
      channel: active ? 'App' : silent ? '电话' : channels[index % channels.length],
      archetype: customer.archetype,
      cust_tag: highNetWorth ? '高净值客户' : '普通客户',
    });

    const primary = mgr_info[index % mgr_info.length];
    service_relation.push({
      relation_id: `SR-${String(index * 2 + 1).padStart(6, '0')}`,
      cust_id: customer.id,
      mgr_id: primary.mgr_id,
      relation_type: '主办',
      is_primary: 1,
      start_date: dateOffset((index % 60) + 1, index % 20),
    });
    if (random() < 0.32) {
      const assist = mgr_info[(index * 7 + 3) % mgr_info.length];
      service_relation.push({
        relation_id: `SR-${String(index * 2 + 2).padStart(6, '0')}`,
        cust_id: customer.id,
        mgr_id: assist.mgr_id,
        relation_type: '协办',
        is_primary: 0,
        start_date: dateOffset((index % 36) + 1, index % 15),
      });
    }

    cust_asset.push({
      asset_id: `A-${String(index + 1).padStart(6, '0')}`,
      cust_id: customer.id,
      stat_date: analyticsSeedReferenceDate,
      total_asset: total,
      daily_avg_asset: Math.round(total * (0.86 + random() * 0.14)),
      cash_balance: Math.round(total * (1 - holdShare)),
      hold_value: Math.round(total * holdShare),
    });

    const holdingCount = 1 + Math.floor(random() * 4);
    for (let n = 0; n < holdingCount; n += 1) {
      const product = analyticsProducts[Math.floor(random() * analyticsProducts.length)];
      const value = Math.round((total * holdShare) / holdingCount * (0.6 + random() * 0.8));
      const profit = Number((customer.drawdown / 100 * (product.volatility) * -1 + (random() - 0.4) * 0.1).toFixed(4));
      cust_holding.push({
        holding_id: `H-${String(cust_holding.length + 1).padStart(7, '0')}`,
        cust_id: customer.id,
        prod_id: product.prod_id,
        market_value: value,
        cost_value: Math.round(value / Math.max(0.5, 1 + profit)),
        profit_ratio: profit,
        hold_date: dateOffset((index % 48) + 2, index % 25),
      });
    }

    const tradeCount = silent ? Math.floor(random() * 2) : active ? 6 + Math.floor(random() * 12) : 1 + Math.floor(random() * 5);
    for (let n = 0; n < tradeCount; n += 1) {
      const product = analyticsProducts[Math.floor(random() * analyticsProducts.length)];
      cust_trade.push({
        trade_id: `T-${String(cust_trade.length + 1).padStart(7, '0')}`,
        cust_id: customer.id,
        prod_id: product.prod_id,
        trade_date: dateOffset(0, Math.floor(random() * 400)),
        trade_type: random() < 0.48 ? '买入' : '卖出',
        trade_amount: Math.round(2 * size + random() * 60 * size),
        channel: channels[Math.floor(random() * channels.length)],
      });
    }

    const flowCount = silent ? Math.floor(random() * 3) : active ? 2 + Math.floor(random() * 5) : 1 + Math.floor(random() * 3);
    for (let n = 0; n < flowCount; n += 1) {
      cust_cashflow.push({
        flow_id: `F-${String(cust_cashflow.length + 1).padStart(7, '0')}`,
        cust_id: customer.id,
        flow_date: dateOffset(0, Math.floor(random() * 400)),
        flow_type: silent ? (random() < 0.72 ? '流出' : '流入') : random() < 0.5 ? '流入' : '流出',
        amount: Math.round(1 * size + random() * 40 * size),
        channel: flowChannels[Math.floor(random() * flowChannels.length)],
      });
    }
  });

  const dim_common = [
    ...['C1', 'C2', 'C3', 'C4', 'C5'].map((code, index) => ({ dim_type: 'risk_level', dim_code: code, dim_name: `风险承受等级 ${code}`, sort_no: index + 1 })),
    ...channels.map((code, index) => ({ dim_type: 'channel', dim_code: code, dim_name: `${code} 渠道`, sort_no: index + 1 })),
    ...['高净值客户', '普通客户'].map((code, index) => ({ dim_type: 'cust_tag', dim_code: code, dim_name: code, sort_no: index + 1 })),
    ...['权益类', '混合类', '固收类', '现金类', '商品类'].map((code, index) => ({ dim_type: 'prod_type', dim_code: code, dim_name: code, sort_no: index + 1 })),
    ...branches.map((code, index) => ({ dim_type: 'branch', dim_code: code, dim_name: code, sort_no: index + 1 })),
  ];

  return { cust_info, mgr_info, prod_info: analyticsProducts, service_relation, dim_common, cust_holding, cust_asset, cust_trade, cust_cashflow };
}

type D1Like = {
  prepare: (sql: string) => { bind: (...values: unknown[]) => { run: () => Promise<unknown> }; run: () => Promise<unknown>; first: () => Promise<unknown> };
  batch: (statements: unknown[]) => Promise<unknown>;
};

/**
 * 建表并（首次）装载合成数据。幂等：已有数据时直接返回，不会重复插入。
 * 返回本次实际装载的行数，便于接口与审计记录。
 */
export async function ensureAnalyticsData(db: D1Like, customerCount = 1000, seed = 20260830): Promise<{ seeded: boolean; rows: number }> {
  await db.batch([...analyticsDdl().map((sql) => db.prepare(sql)), ...analyticsIndexes.map((sql) => db.prepare(sql))]);

  const existing = (await db.prepare('SELECT COUNT(*) AS n FROM cust_info').first()) as { n?: number } | null;
  if ((existing?.n ?? 0) > 0) return { seeded: false, rows: existing?.n ?? 0 };

  const data = buildAnalyticsSeed(customerCount, seed);
  let rows = 0;
  for (const [table, list] of Object.entries(data)) {
    const columns = Object.keys(list[0] ?? {});
    if (columns.length === 0) continue;
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    const statements = list.map((row) => db.prepare(sql).bind(...columns.map((column) => row[column])));
    for (let index = 0; index < statements.length; index += 40) {
      await db.batch(statements.slice(index, index + 40));
    }
    rows += list.length;
  }
  return { seeded: true, rows };
}
