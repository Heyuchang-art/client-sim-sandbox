export type ComplianceSeverity = 'block' | 'review' | 'notice';
export type ComplianceScope = 'message' | 'strategy';
export type RiskLevel = 'C1' | 'C2' | 'C3' | 'C4' | 'C5';

export type ComplianceRule = {
  id: string;
  title: string;
  severity: ComplianceSeverity;
  scope: ComplianceScope;
  kind: 'forbidden' | 'required';
  pattern: RegExp;
  /** 命中片段处于否定 / 免责语境时降级为提示，避免误拦“无法承诺收益”这类合规表达。 */
  negationAware: boolean;
  advice: string;
};

export const RULE_VERSION = 'compliance-rules@2026.09';

export const severityLabels: Record<ComplianceSeverity, '阻断' | '警告' | '提示'> = {
  block: '阻断',
  review: '警告',
  notice: '提示',
};

export const statusBySeverity: Record<ComplianceSeverity, '已拦截' | '待审批' | '通过'> = {
  block: '已拦截',
  review: '待审批',
  notice: '通过',
};

export const riskLevels: RiskLevel[] = ['C1', 'C2', 'C3', 'C4', 'C5'];

export const productRiskByProduct: Record<string, number> = {
  红利低波组合: 2,
  量化增强产品: 3,
  科技成长组合: 4,
  新能源主题基金: 5,
};

export function productRiskLevel(product: string) {
  return productRiskByProduct[product] ?? 3;
}

/**
 * 适当性矩阵：产品风险等级与客户风险承受等级的差值决定放行 / 复核 / 阻断。
 */
export function checkSuitability(customerLevel: RiskLevel, productRisk: number): 'allow' | 'review' | 'block' {
  const customerRisk = riskLevels.indexOf(customerLevel) + 1;
  const gap = productRisk - customerRisk;
  if (gap >= 2) return 'block';
  if (gap === 1) return 'review';
  return 'allow';
}

export const complianceRules: ComplianceRule[] = [
  {
    id: 'AD-CONTENT-01',
    title: '收益承诺与保本表达',
    severity: 'block',
    scope: 'message',
    kind: 'forbidden',
    pattern: /保证收益|承诺收益|收益保证|确保(收益|盈利)|保本|保底|稳赚|包赚|必赚|零风险|无风险/,
    negationAware: true,
    advice: '删除收益承诺，改为说明风险特征与不确定性。',
  },
  {
    id: 'AD-CONTENT-02',
    title: '绝对化收益断言',
    severity: 'block',
    scope: 'message',
    kind: 'forbidden',
    pattern: /(一定|必然|肯定|绝对)(会)?(上涨|反弹|回升|盈利|赚钱|获利|上涨)/,
    negationAware: true,
    advice: '不得对未来涨跌作确定性判断。',
  },
  {
    id: 'AD-CONTENT-03',
    title: '错失恐惧与抄底话术',
    severity: 'block',
    scope: 'message',
    kind: 'forbidden',
    pattern: /错过(本轮|这次|这波)?(反弹|行情|上涨|机会)|抄底(必|稳)|机不可失|最后(一次)?机会/,
    negationAware: true,
    advice: '不得用错失恐惧推动客户决策。',
  },
  {
    id: 'AD-CONTENT-04',
    title: '夸大收益描述',
    severity: 'review',
    scope: 'message',
    kind: 'forbidden',
    pattern: /(收益|回报|涨幅)(翻倍|翻番)|最高(收益|回报)|超额(收益|回报)保证/,
    negationAware: true,
    advice: '收益描述需附风险提示并由合规复核。',
  },
  {
    id: 'AD-CONTENT-05',
    title: '历史业绩暗示未来',
    severity: 'review',
    scope: 'message',
    kind: 'forbidden',
    pattern: /(历史|过往)(业绩|收益|表现|数据).{0,15}(预示|说明|证明|代表|保证)/,
    negationAware: true,
    advice: '历史业绩不预示未来表现，需显式声明。',
  },
  {
    id: 'AD-CONTENT-06',
    title: '本金安全承诺',
    severity: 'block',
    scope: 'message',
    kind: 'forbidden',
    pattern: /(本金|资产)(安全|无忧|不亏|绝对安全)|不会(亏损|亏钱)|亏损包赔/,
    negationAware: true,
    advice: '不得对本金安全作承诺。',
  },
  {
    id: 'SUITABILITY-01',
    title: '替客户做决策',
    severity: 'block',
    scope: 'message',
    kind: 'forbidden',
    pattern: /(建议|应该|必须|直接).{0,4}(清仓|全部卖出|满仓|全部买入|加杠杆)/,
    negationAware: true,
    advice: '只能提供信息与选项，决策权归客户。',
  },
  {
    id: 'SUITABILITY-02',
    title: '诱导性紧迫表达',
    severity: 'block',
    scope: 'message',
    kind: 'forbidden',
    pattern: /(必须|务必|尽快|马上|立刻|立即).{0,2}(行动|操作|下单|买入|卖出|清仓)|限时(买入|申购|抢购)/,
    negationAware: true,
    advice: '不得制造紧迫感推动交易。',
  },
  {
    id: 'SUITABILITY-03',
    title: '高风险产品越级推荐',
    severity: 'review',
    scope: 'strategy',
    kind: 'forbidden',
    pattern: /(推荐|建议).{0,10}(高波动|高风险|杠杆|衍生品|激进)/,
    negationAware: true,
    advice: '高风险产品推荐需与客户风险等级匹配并人工复核。',
  },
  {
    id: 'SUITABILITY-04',
    title: '缺少适当性说明',
    severity: 'review',
    scope: 'strategy',
    kind: 'required',
    pattern: /(风险等级|承受能力|适当性)/,
    negationAware: false,
    advice: '策略文本需包含适当性匹配说明。',
  },
  {
    id: 'RISK-DISCLOSURE-01',
    title: '缺少风险揭示',
    severity: 'notice',
    scope: 'strategy',
    kind: 'required',
    pattern: /(风险|波动|不确定性)/,
    negationAware: false,
    advice: '策略文本需包含风险提示。',
  },
  {
    id: 'RISK-DISCLOSURE-02',
    title: '缺少不承诺收益声明',
    severity: 'notice',
    scope: 'message',
    kind: 'required',
    pattern: /(无法承诺|不构成|不代表|不保证|不能保证)/,
    negationAware: false,
    advice: '话术需包含不承诺收益的声明。',
  },
  {
    id: 'MARKET-CONDUCT-01',
    title: '内幕与未公开信息',
    severity: 'block',
    scope: 'message',
    kind: 'forbidden',
    pattern: /内幕|未公开信息|内部消息|小道消息|提前知道/,
    negationAware: false,
    advice: '严禁引用未公开信息。',
  },
  {
    id: 'MARKET-CONDUCT-02',
    title: '市场操纵式表达',
    severity: 'review',
    scope: 'message',
    kind: 'forbidden',
    pattern: /(配合|联手).{0,6}(拉抬|拉升|出货)|(庄家|主力).{0,6}(会|即将)(拉|砸)/,
    negationAware: true,
    advice: '不得暗示操纵或跟庄行为。',
  },
  {
    id: 'MARKET-CONDUCT-03',
    title: '不当横向对比',
    severity: 'review',
    scope: 'message',
    kind: 'forbidden',
    pattern: /比(银行存款|理财|存款).{0,8}(更赚|收益更高|强)/,
    negationAware: true,
    advice: '产品对比需完整披露风险与期限差异。',
  },
  {
    id: 'MARKET-CONDUCT-04',
    title: '诱导频繁交易',
    severity: 'review',
    scope: 'message',
    kind: 'forbidden',
    pattern: /(频繁|短线)(交易|操作).{0,10}(推荐|建议|更好)|多做(几)?笔/,
    negationAware: true,
    advice: '不得鼓励高频交易。',
  },
  {
    id: 'DATA-PRIVACY-01',
    title: '敏感字段外泄',
    severity: 'block',
    scope: 'message',
    kind: 'forbidden',
    pattern: /身份证|银行卡号|交易密码|验证码|家庭住址/,
    negationAware: false,
    advice: '不得在触达内容中携带敏感个人信息。',
  },
  {
    id: 'DATA-PRIVACY-02',
    title: '引用其他客户信息',
    severity: 'review',
    scope: 'message',
    kind: 'forbidden',
    pattern: /(其他|别的)客户.{0,10}(持有|买入|卖出|赚|亏)/,
    negationAware: true,
    advice: '不得向客户披露其他客户的持仓或盈亏。',
  },
  {
    id: 'HUMAN-ANCHORING-01',
    title: '缺少人工责任锚定',
    severity: 'notice',
    scope: 'strategy',
    kind: 'required',
    pattern: /(人工|客户经理|复核|审批)/,
    negationAware: false,
    advice: '策略需保留人工确认环节。',
  },
];

const negationPattern = /不|未|无|没|禁止|避免|杜绝|严禁|拒绝|勿|莫|不得|不能|不会|无法/;
const clauseBreakers = ['。', '；', '！', '？', '\n', '，', ',', ';'];
/** 标准免责表达：出现在命中片段内部或紧随其后时，按非阻断处理。 */
const exemptionPattern = /^(不代表|不构成|不保证|不承诺|不预示|不意味着|不能保证|无法保证|不能承诺|无法承诺)/;

function clauseWindowBefore(text: string, index: number, size: number) {
  const before = text.slice(Math.max(0, index - size), index);
  let clauseStart = 0;
  for (const breaker of clauseBreakers) {
    const position = before.lastIndexOf(breaker);
    if (position + 1 > clauseStart) clauseStart = position + 1;
  }
  return before.slice(clauseStart);
}

/**
 * 否定 / 免责语境判定：
 * 1) 命中片段之前的同一小句出现否定标记（例如“我不会催促您立即操作”）；
 * 2) 命中片段自身包含标准免责表达（例如“历史业绩不代表”）；
 * 3) 命中片段之后紧邻同一小句内出现标准免责表达。
 * 只做逐句判断，避免跨句免责声明把真实违规“洗白”。
 */
export function isNegated(text: string, index: number, length: number) {
  const matchedText = text.slice(index, index + length);
  if (negationPattern.test(clauseWindowBefore(text, index, 12))) return true;
  if (exemptionPattern.test(matchedText.trimStart())) return true;
  const after = text.slice(index + length, index + length + 8);
  const sameClause = after.split(/[。；！？\n，,;]/)[0] ?? '';
  return exemptionPattern.test(sameClause.trimStart());
}

export function effectiveSeverity(rule: ComplianceRule, negated: boolean): ComplianceSeverity {
  if (!negated) return rule.severity;
  if (rule.severity === 'block') return 'notice';
  if (rule.severity === 'review') return 'notice';
  return 'notice';
}
