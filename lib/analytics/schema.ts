/**
 * 赛题要求的九张业务表：表结构定义与列白名单。
 *
 * 表名与列名用英文（便于生成与校验 SQL），中文名与口径说明放在元数据层。
 * 这里同时是安全围栏的数据来源：语义层校验用的表名、列名白名单就从本文件生成，
 * 避免白名单与建表语句两处维护、各写一份。
 */

export type ColumnDef = {
  name: string;
  type: 'TEXT' | 'INTEGER' | 'REAL';
  label: string;
  /** 列的业务口径，供模型理解 */
  meaning: string;
};

export type TableDef = {
  name: string;
  label: string;
  /** 表在业务上回答什么问题 */
  purpose: string;
  columns: ColumnDef[];
};

export const analyticsTables: TableDef[] = [
  {
    name: 'cust_info',
    label: '客户信息表',
    purpose: '客户的基本属性：等级、年龄、性别、开户信息与客群标签，是人群筛选的主表。',
    columns: [
      { name: 'cust_id', type: 'TEXT', label: '客户号', meaning: '客户唯一标识' },
      { name: 'cust_name', type: 'TEXT', label: '客户姓名', meaning: '脱敏姓名' },
      { name: 'gender', type: 'TEXT', label: '性别', meaning: '男 / 女' },
      { name: 'age', type: 'INTEGER', label: '年龄', meaning: '周岁' },
      { name: 'risk_level', type: 'TEXT', label: '风险承受等级', meaning: 'C1 最低、C5 最高' },
      { name: 'open_date', type: 'TEXT', label: '开户日期', meaning: 'YYYY-MM-DD' },
      { name: 'branch', type: 'TEXT', label: '所属营业部', meaning: '开户营业部' },
      { name: 'channel', type: 'TEXT', label: '主要服务渠道', meaning: 'App / 电话 / 线下' },
      { name: 'archetype', type: 'TEXT', label: '客户画像', meaning: '五类原型的名称' },
      { name: 'cust_tag', type: 'TEXT', label: '客群标签', meaning: '如高净值、活跃、沉默' },
    ],
  },
  {
    name: 'mgr_info',
    label: '服务经理信息表',
    purpose: '客户经理的基本信息，用于按服务关系圈定客户。',
    columns: [
      { name: 'mgr_id', type: 'TEXT', label: '员工号', meaning: '客户经理唯一标识' },
      { name: 'mgr_name', type: 'TEXT', label: '姓名', meaning: '脱敏姓名' },
      { name: 'branch', type: 'TEXT', label: '所属营业部', meaning: '所属分支机构' },
      { name: 'team', type: 'TEXT', label: '团队', meaning: '所属团队' },
      { name: 'title', type: 'TEXT', label: '职级', meaning: '如高级客户经理' },
      { name: 'join_date', type: 'TEXT', label: '入职日期', meaning: 'YYYY-MM-DD' },
    ],
  },
  {
    name: 'prod_info',
    label: '产品信息表',
    purpose: '在售产品的风险等级与波动特征。',
    columns: [
      { name: 'prod_id', type: 'TEXT', label: '产品代码', meaning: '产品唯一标识' },
      { name: 'prod_name', type: 'TEXT', label: '产品名称', meaning: '产品全称' },
      { name: 'prod_type', type: 'TEXT', label: '产品类型', meaning: '如权益类、固收类' },
      { name: 'risk_level', type: 'INTEGER', label: '产品风险等级', meaning: 'R1 至 R5' },
      { name: 'volatility', type: 'REAL', label: '波动系数', meaning: '相对基准的波动倍数' },
      { name: 'mgr_fee_rate', type: 'REAL', label: '管理费率', meaning: '年化费率' },
    ],
  },
  {
    name: 'service_relation',
    label: '服务关系表',
    purpose: '客户与客户经理的服务关系，含主协办与起止时间。',
    columns: [
      { name: 'relation_id', type: 'TEXT', label: '关系编号', meaning: '关系唯一标识' },
      { name: 'cust_id', type: 'TEXT', label: '客户号', meaning: '关联 cust_info.cust_id' },
      { name: 'mgr_id', type: 'TEXT', label: '员工号', meaning: '关联 mgr_info.mgr_id' },
      { name: 'relation_type', type: 'TEXT', label: '关系类型', meaning: '主办 / 协办' },
      { name: 'is_primary', type: 'INTEGER', label: '是否主关系', meaning: '1 为主办，0 为协办' },
      { name: 'start_date', type: 'TEXT', label: '关系开始日期', meaning: 'YYYY-MM-DD' },
    ],
  },
  {
    name: 'dim_common',
    label: '公共维表',
    purpose: '统一维护各类维度取值与中文名，避免业务口径散落各处。',
    columns: [
      { name: 'dim_type', type: 'TEXT', label: '维度类型', meaning: 'risk_level / channel / cust_tag / prod_type 等' },
      { name: 'dim_code', type: 'TEXT', label: '维度编码', meaning: '维度取值编码' },
      { name: 'dim_name', type: 'TEXT', label: '维度名称', meaning: '维度取值中文名' },
      { name: 'sort_no', type: 'INTEGER', label: '排序号', meaning: '展示顺序' },
    ],
  },
  {
    name: 'cust_holding',
    label: '客户持仓表',
    purpose: '客户当前持有的产品、市值与盈亏，是圈定「持有某类产品」人群的依据。',
    columns: [
      { name: 'holding_id', type: 'TEXT', label: '持仓编号', meaning: '持仓唯一标识' },
      { name: 'cust_id', type: 'TEXT', label: '客户号', meaning: '关联 cust_info.cust_id' },
      { name: 'prod_id', type: 'TEXT', label: '产品代码', meaning: '关联 prod_info.prod_id' },
      { name: 'market_value', type: 'REAL', label: '持仓市值', meaning: '单位：元' },
      { name: 'cost_value', type: 'REAL', label: '持仓成本', meaning: '单位：元' },
      { name: 'profit_ratio', type: 'REAL', label: '持仓收益率', meaning: '小数，负数表示亏损' },
      { name: 'hold_date', type: 'TEXT', label: '建仓日期', meaning: 'YYYY-MM-DD' },
    ],
  },
  {
    name: 'cust_asset',
    label: '客户资产表',
    purpose: '客户的资产规模与结构，是「高净值客户」等口径的计算依据。',
    columns: [
      { name: 'asset_id', type: 'TEXT', label: '记录编号', meaning: '唯一标识' },
      { name: 'cust_id', type: 'TEXT', label: '客户号', meaning: '关联 cust_info.cust_id' },
      { name: 'stat_date', type: 'TEXT', label: '统计日期', meaning: 'YYYY-MM-DD' },
      { name: 'total_asset', type: 'REAL', label: '总资产', meaning: '单位：元' },
      { name: 'daily_avg_asset', type: 'REAL', label: '日均资产', meaning: '近 30 日日均，单位：元' },
      { name: 'cash_balance', type: 'REAL', label: '可用资金', meaning: '单位：元' },
      { name: 'hold_value', type: 'REAL', label: '持仓市值合计', meaning: '单位：元' },
    ],
  },
  {
    name: 'cust_trade',
    label: '客户交易表',
    purpose: '客户的交易流水，用于活跃度、交易频次与偏好分析。',
    columns: [
      { name: 'trade_id', type: 'TEXT', label: '交易编号', meaning: '唯一标识' },
      { name: 'cust_id', type: 'TEXT', label: '客户号', meaning: '关联 cust_info.cust_id' },
      { name: 'prod_id', type: 'TEXT', label: '产品代码', meaning: '关联 prod_info.prod_id' },
      { name: 'trade_date', type: 'TEXT', label: '交易日期', meaning: 'YYYY-MM-DD' },
      { name: 'trade_type', type: 'TEXT', label: '交易方向', meaning: '买入 / 卖出' },
      { name: 'trade_amount', type: 'REAL', label: '交易金额', meaning: '单位：元' },
      { name: 'channel', type: 'TEXT', label: '交易渠道', meaning: 'App / 电话 / 线下' },
    ],
  },
  {
    name: 'cust_cashflow',
    label: '客户资产流入流出表',
    purpose: '资金进出记录，是留存与流失分析的核心依据。',
    columns: [
      { name: 'flow_id', type: 'TEXT', label: '流水编号', meaning: '唯一标识' },
      { name: 'cust_id', type: 'TEXT', label: '客户号', meaning: '关联 cust_info.cust_id' },
      { name: 'flow_date', type: 'TEXT', label: '发生日期', meaning: 'YYYY-MM-DD' },
      { name: 'flow_type', type: 'TEXT', label: '方向', meaning: '流入 / 流出' },
      { name: 'amount', type: 'REAL', label: '金额', meaning: '单位：元，恒为正数' },
      { name: 'channel', type: 'TEXT', label: '渠道', meaning: '银证转账 / 产品赎回 等' },
    ],
  },
];

/** 建表语句：由表定义生成，保证 DDL 与白名单同源。 */
export function analyticsDdl(): string[] {
  return analyticsTables.map((table) =>
    `CREATE TABLE IF NOT EXISTS ${table.name} (\n` +
    table.columns.map((column) => `      ${column.name} ${column.type}`).join(',\n') +
    `\n    )`,
  );
}

export const analyticsIndexes: string[] = [
  'CREATE INDEX IF NOT EXISTS cust_info_risk ON cust_info (risk_level)',
  'CREATE INDEX IF NOT EXISTS cust_holding_cust ON cust_holding (cust_id)',
  'CREATE INDEX IF NOT EXISTS cust_holding_prod ON cust_holding (prod_id)',
  'CREATE INDEX IF NOT EXISTS cust_trade_cust ON cust_trade (cust_id)',
  'CREATE INDEX IF NOT EXISTS cust_cashflow_cust ON cust_cashflow (cust_id)',
  'CREATE INDEX IF NOT EXISTS service_relation_cust ON service_relation (cust_id)',
];

export const analyticsTableNames = analyticsTables.map((table) => table.name);

/** 表名 → 列名集合，安全围栏的语义层白名单。 */
export const analyticsColumnWhitelist: Record<string, Set<string>> = Object.fromEntries(
  analyticsTables.map((table) => [table.name, new Set(table.columns.map((column) => column.name))]),
);

export function tableLabel(name: string) {
  return analyticsTables.find((table) => table.name === name)?.label ?? name;
}
