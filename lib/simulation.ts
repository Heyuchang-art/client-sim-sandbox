import {
  RULE_VERSION,
  reviewCandidates,
  suitabilityFinding,
  type ComplianceFinding,
  type ComplianceCandidate,
} from './compliance';
import {
  defaultScenario,
  segmentBetaThreshold,
  segmentCriteria,
  stepHours,
  type ScenarioConfig,
  type TargetSegment,
} from './scenario';

export type StrategyId = 'baseline' | 'broadcast' | 'segmented';

export type Psychology = {
  lossAversion: number;
  herding: number;
  ambition: number;
  discipline: number;
  patience: number;
  trust: number;
};

export type Customer = {
  id: string;
  name: string;
  archetype: string;
  riskLevel: 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  product: string;
  productRisk: number;
  drawdown: number;
  holdingBeta: number;
  influence: number;
  psychology: Psychology;
  panic: number;
  buy: number;
  hold: number;
  sell: number;
  consult: number;
  complaint: number;
  churn: number;
  priority: '高' | '中' | '低';
  /** 本次模拟中的峰值暴露：干预生效后期末状态会回落，队列排序必须依据峰值。 */
  peakPanic: number;
  peakSell: number;
  peakComplaint: number;
  peakRisk: number;
  peakStep: number;
};

export type RelationshipType = 'similarity' | 'social' | 'service';

export type RelationshipEdge = {
  source: string;
  target: string;
  type: RelationshipType;
  weight: number;
};

export type Snapshot = {
  step: number;
  stepHours: number;
  panic: number;
  buy: number;
  hold: number;
  sell: number;
  consult: number;
  complaint: number;
  churn: number;
  trust: number;
  coverage: number;
  contagion: number;
};

export type CustomerTimeState = {
  id: string;
  panic: number;
  trust: number;
  buy: number;
  hold: number;
  sell: number;
  consult: number;
  complaint: number;
  churn: number;
  priority: '高' | '中' | '低';
};

export type MacroCommunicationPlan = {
  objective: string;
  targetAudience: string;
  channels: string[];
  cadence: string;
  owner: string;
  escalationRule: string;
  guardrail: string;
  phases: Array<{
    name: string;
    window: string;
    action: string;
  }>;
};

export type MicroCommunicationPlan = {
  urgency: '立即' | '优先' | '常规';
  objective: string;
  channel: string;
  timing: string;
  tone: string;
  opening: string;
  keyPoints: string[];
  recommendedMessage: string;
  avoid: string;
  evidence: string[];
};

export type AuditEntry = {
  seq: number;
  actor: string;
  action: string;
  result: string;
  status: 'completed' | 'blocked' | 'pending';
  /** 真实时间戳由服务端执行器写入；引擎自身保持确定性。 */
  at?: number;
  model?: string;
};

export type StrategyResult = {
  id: StrategyId;
  name: string;
  description: string;
  score: number;
  snapshots: Snapshot[];
  customerStates: CustomerTimeState[][];
  peakPanic: number;
  finalSell: number;
  finalComplaint: number;
  finalChurn: number;
  finalTrust: number;
  complianceRisk: '低' | '中' | '高';
  findings: ComplianceFinding[];
  draftText: string;
  effectiveDraftText: string;
  macroPlan: MacroCommunicationPlan;
};

export type AblationFlags = {
  disablePsychology?: boolean;
  disableContagion?: boolean;
  disableMemory?: boolean;
  disableCompliance?: boolean;
};

export type ScenarioMeta = {
  stepHours: number;
  segment: TargetSegment;
  segmentCriteria: string;
  generatedCustomers: number;
  excludedCustomers: number;
  segmentRelaxed: boolean;
  ruleVersion: string;
  ablations: Required<AblationFlags>;
};

export type StrategyDraftOverride = {
  id: string;
  description?: string;
  draftText?: string;
};

export type SimulationOptions = {
  ablations?: AblationFlags;
  /** 由模型生成、并已通过结构校验的候选策略文本；数值参数仍由确定性引擎持有。 */
  strategyDrafts?: StrategyDraftOverride[];
};

export type SimulationResult = {
  scenario: ScenarioConfig;
  scenarioMeta: ScenarioMeta;
  seed: number;
  durationMs: number;
  customerCount: number;
  customers: Customer[];
  relationships: RelationshipEdge[];
  strategies: StrategyResult[];
  recommended: StrategyId;
  findings: ComplianceFinding[];
  explanationFactors: Array<{
    label: string;
    weight: number;
    evidence: string;
    direction: '风险上升' | '风险缓释';
  }>;
  audit: AuditEntry[];
};

export const allAblationsOff: Required<AblationFlags> = {
  disablePsychology: false,
  disableContagion: false,
  disableMemory: false,
  disableCompliance: false,
};

export const strategyDefinitions: Array<{
  id: StrategyId;
  name: string;
  description: string;
  calming: number;
  trustLift: number;
  coverage: number;
  toneRisk: number;
  draftText: string;
  compliantDraftText: string;
}> = [
  {
    id: 'baseline',
    name: '不主动沟通',
    description: '保持现状，仅响应客户主动咨询。',
    calming: 0,
    trustLift: -0.035,
    coverage: 0.08,
    toneRisk: 0,
    draftText: '本次市场调整期间不主动触达客户，等待客户主动咨询后再提供标准风险说明。',
    compliantDraftText: '本次市场调整期间不主动触达客户，等待客户主动咨询后再提供标准风险说明。',
  },
  {
    id: 'broadcast',
    name: '统一风险提示',
    description: '向全部目标客户发送统一的市场风险通知。',
    calming: 0.07,
    trustLift: 0.02,
    coverage: 0.95,
    toneRisk: 0.055,
    draftText: '向全部目标客户统一推送：请务必立即行动锁定收益，本轮调整后一定反弹，不要错过这次机会。',
    compliantDraftText: '向全部目标客户统一推送市场风险说明：解释本次下跌原因与产品波动特征，提示风险并提供人工服务入口，不包含催促、收益判断或反弹预期。',
  },
  {
    id: 'segmented',
    name: '分群差异化沟通',
    description: '按风险偏好与心理特征生成差异化内容，优先干预关键节点。',
    calming: 0.19,
    trustLift: 0.095,
    coverage: 0.86,
    toneRisk: 0,
    draftText: '按客户风险等级与心理特征分群触达，优先人工干预高影响节点，先说明风险再给选项。',
    compliantDraftText: '按客户风险等级与心理特征分群触达，优先人工干预高影响节点，先说明风险再给选项。',
  },
];

function buildMacroCommunicationPlan(strategy: (typeof strategyDefinitions)[number], scenario: ScenarioConfig): MacroCommunicationPlan {
  const shock = `${Math.abs(scenario.marketShock * 100).toFixed(0)}%`;
  const hours = `${scenario.durationHours} 小时`;
  if (strategy.id === 'baseline') {
    return {
      objective: `在市场下跌 ${shock}、持续约 ${hours} 的情况下维持被动服务，保留资源应对客户主动咨询。`,
      targetAudience: '主动咨询、投诉或触发风险阈值的客户',
      channels: ['客服热线', 'App 在线客服'],
      cadence: '事件触发后响应，不主动批量触达',
      owner: '客服团队',
      escalationRule: '投诉风险超过 25% 或流失风险超过 20% 时转客户经理',
      guardrail: '不得因未主动触达而遗漏已触发适当性风险的客户',
      phases: [
        { name: '监测', window: '0—2 小时', action: '持续监测咨询量、卖出倾向与投诉信号' },
        { name: '响应', window: '2—8 小时', action: '仅对主动咨询客户提供标准风险说明' },
        { name: '复核', window: '8—24 小时', action: '复核高风险未触达客户并决定是否升级' },
      ],
    };
  }
  if (strategy.id === 'broadcast') {
    return {
      objective: `快速覆盖市场下跌 ${shock}、预计持续 ${hours} 的目标客群，统一解释风险并降低信息真空。`,
      targetAudience: '持有高波动产品的全部目标客户',
      channels: ['App 推送', '短信', '企业微信'],
      cadence: '首轮立即触达，4 小时后根据风险变化补充一次',
      owner: '客户运营团队',
      escalationRule: '未读且恐慌超过 62% 的客户转人工；投诉倾向超过 25% 立即暂停自动触达',
      guardrail: '统一文案仅作风险说明，不包含收益承诺、行动催促或产品推荐，不得暗示反弹确定性',
      phases: [
        { name: '定调', window: '0—1 小时', action: '发布统一市场说明，明确风险与服务入口' },
        { name: '覆盖', window: '1—6 小时', action: '完成多渠道覆盖并监测打开、咨询和投诉' },
        { name: '分流', window: '6—24 小时', action: '把持续高风险客户分流至人工服务' },
      ],
    };
  }
  return {
    objective: `针对市场下跌 ${shock}、持续约 ${hours} 实施分群干预，优先稳定高恐慌、高影响力客户并抑制情绪扩散。`,
    targetAudience: '高恐慌、高影响力、低信任及高流失倾向客户优先',
    channels: ['客户经理电话', '企业微信', 'App 个性化消息'],
    cadence: '高优客户 30 分钟内触达，中优客户 2 小时内触达，状态恶化时二次跟进',
    owner: '客户经理牵头，投顾与合规协同',
    escalationRule: '恐慌超过 62%、投诉超过 25% 或高影响节点持续恶化时立即人工接管',
    guardrail: '话术必须与客户风险等级匹配；涉及具体操作与产品时需人工确认',
    phases: [
      { name: '止扩散', window: '0—2 小时', action: '锁定关键传播节点，先人工干预高风险高影响客户' },
      { name: '分群稳定', window: '2—8 小时', action: '按心理特征、风险等级和沟通偏好差异化触达' },
      { name: '回访校准', window: '8—24 小时', action: '依据状态变化二次跟进，并回流真实反馈校准模型' },
    ],
  };
}

export function buildMicroCommunicationPlan(
  customer: Customer,
  state: CustomerTimeState,
  scenario: ScenarioConfig,
): MicroCommunicationPlan {
  const p = customer.psychology;
  const urgency: MicroCommunicationPlan['urgency'] =
    state.priority === '高' || state.panic > 0.62 || state.complaint > 0.25 ? '立即' :
      state.priority === '中' || state.panic > 0.42 || state.churn > 0.18 ? '优先' : '常规';
  const lowTrust = state.trust < 0.45;
  const lossSensitive = p.lossAversion >= Math.max(p.herding, p.ambition, p.discipline, p.patience);
  const herdSensitive = p.herding > 0.68;
  const channel = urgency === '立即' || lowTrust ? '客户经理电话' : state.consult > 0.35 ? '企业微信一对一' : 'App 个性化消息';
  const timing = urgency === '立即' ? '30 分钟内人工触达' : urgency === '优先' ? '2 小时内触达并在 4 小时后复核' : '本时段内轻量触达，次日回访';
  const tone = lowTrust ? '坦诚、可核验、避免说教' : lossSensitive ? '先共情，再给事实和选择空间' : herdSensitive ? '稳定、去从众、强调独立判断' : '简洁、理性、尊重客户节奏';
  const objective = state.panic > 0.55 ? '先稳定情绪并阻断冲动决策' : state.churn > 0.18 ? '修复信任并确认服务诉求' : state.consult > 0.3 ? '解答疑问并帮助客户重新核对风险承受能力' : '主动提供信息，保持服务连续性';
  const marketDrop = Math.abs(scenario.marketShock * 100).toFixed(0);
  const archetypeAdvice = customer.archetype.includes('稳健')
    ? '重点说明当前波动与其稳健目标是否仍匹配，不主动推介高风险产品。'
    : customer.archetype.includes('成长')
      ? '把短期波动放回原定投资期限讨论，同时确认其资金使用安排是否变化。'
      : customer.archetype.includes('高频') || customer.archetype.includes('进取')
        ? '用明确数据回应，不强化短期交易冲动，提醒交易成本与风险边界。'
        : '先询问近期资金安排和服务感受，避免连续自动消息加剧流失。';
  const opening = `${customer.name}您好，我注意到今天市场波动较大，也看到您持有的${customer.product}出现了回撤，想先了解一下您现在最担心的是短期亏损、资金安排，还是后续市场变化？`;
  const recommendedMessage = `${opening} 今天市场整体下跌约 ${marketDrop}%，短期波动可能放大情绪和交易压力。我们可以先一起核对这项持仓的风险特征、您的原定投资期限和当前资金需求，再由您决定下一步。${archetypeAdvice}我不会催促您立即操作，也无法承诺收益；如果您愿意，我可以把关键数据和可选处理方式逐项说明。`;
  const evidence = [
    `当前恐慌 ${percent(state.panic)}、卖出倾向 ${percent(state.sell)}`,
    `机构信任 ${percent(state.trust)}、流失倾向 ${percent(state.churn)}`,
    `${lossSensitive ? '损失厌恶' : herdSensitive ? '从众敏感' : '行为画像'}是本次沟通的主要心理依据`,
    `适当性：${customer.riskLevel} 客户 × R${customer.productRisk} 产品`,
  ];
  return {
    urgency,
    objective,
    channel,
    timing,
    tone,
    opening,
    keyPoints: [
      '先确认客户最关心的问题，不预设其必须买入、持有或卖出。',
      archetypeAdvice,
      '说明市场和产品风险，必要时转交具备相应资质的人员继续服务。',
    ],
    recommendedMessage,
    avoid: '避免使用“必须立即操作”“肯定会反弹”“现在卖出一定亏”等诱导、承诺或替客户决策的表达。',
    evidence,
  };
}

const archetypes = [
  { name: '稳健守成型', weight: 0.27, risk: 'C2' as const },
  { name: '长期成长型', weight: 0.25, risk: 'C3' as const },
  { name: '进取交易型', weight: 0.17, risk: 'C4' as const },
  { name: '高频敏感型', weight: 0.14, risk: 'C5' as const },
  { name: '沉默流失型', weight: 0.17, risk: 'C2' as const },
];

const products = ['科技成长组合', '量化增强产品', '新能源主题基金', '红利低波组合'];
const productVolatility: Record<string, number> = {
  科技成长组合: 1.22,
  量化增强产品: 1.04,
  新能源主题基金: 1.34,
  红利低波组合: 0.62,
};
const productRiskByProduct: Record<string, number> = {
  科技成长组合: 4,
  量化增强产品: 3,
  新能源主题基金: 5,
  红利低波组合: 2,
};
const highVolatilityProducts = new Set(['科技成长组合', '量化增强产品', '新能源主题基金']);
const surnames = ['陈', '李', '王', '张', '刘', '周', '徐', '许', '郑', '顾', '沈', '林'];

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function logistic(value: number) {
  return 1 / (1 + Math.exp(-value));
}

/** 个体风险暴露：恐慌、卖出、投诉与网络影响力的加权和。 */
function riskScoreOf(customer: Customer) {
  return customer.panic * 0.35 + customer.sell * 0.3 + customer.complaint * 0.2 + customer.influence * 0.15;
}

/** 优先级阈值按实测峰值暴露分布校准：10%/20%/30% 冲击下峰值区间约 0.11-0.56。 */
function priorityOf(riskScore: number): '高' | '中' | '低' {
  return riskScore >= 0.45 ? '高' : riskScore >= 0.3 ? '中' : '低';
}

function behaviorProbabilities(customer: Customer) {
  const p = customer.psychology;
  let sell = clamp(logistic((customer.panic - 0.58) * 5.2 + p.herding * 0.7 - p.discipline * 1.1));
  let buy = clamp(logistic((0.34 - customer.panic) * 4.4 + p.ambition * 1.2 + p.trust * 0.35) * 0.58);
  const directionalTotal = buy + sell;
  if (directionalTotal > 0.94) {
    buy = (buy / directionalTotal) * 0.94;
    sell = (sell / directionalTotal) * 0.94;
  }
  const hold = clamp(1 - buy - sell);
  const consult = clamp(logistic((customer.panic - 0.32) * 3.4 + p.trust * 0.65 - p.discipline * 0.25) * 0.72);
  return { buy, hold, sell, consult };
}

function initialPanic(shockPercent: number, psychology: Psychology, drawdown: number) {
  return clamp(
    0.1 + psychology.lossAversion * 0.35 + psychology.herding * 0.12 + drawdown / 100 - psychology.discipline * 0.18,
  );
}

function pickArchetype(random: () => number) {
  const cursor = random();
  let cumulative = 0;
  for (const archetype of archetypes) {
    cumulative += archetype.weight;
    if (cursor <= cumulative) return archetype;
  }
  return archetypes[archetypes.length - 1];
}

function psychologyFor(archetype: string, random: () => number): Psychology {
  const jitter = () => (random() - 0.5) * 0.16;
  const bases: Record<string, Psychology> = {
    稳健守成型: { lossAversion: 0.84, herding: 0.42, ambition: 0.28, discipline: 0.82, patience: 0.79, trust: 0.71 },
    长期成长型: { lossAversion: 0.58, herding: 0.46, ambition: 0.61, discipline: 0.69, patience: 0.76, trust: 0.67 },
    进取交易型: { lossAversion: 0.34, herding: 0.58, ambition: 0.86, discipline: 0.41, patience: 0.31, trust: 0.56 },
    高频敏感型: { lossAversion: 0.52, herding: 0.81, ambition: 0.78, discipline: 0.28, patience: 0.18, trust: 0.49 },
    沉默流失型: { lossAversion: 0.68, herding: 0.49, ambition: 0.37, discipline: 0.57, patience: 0.55, trust: 0.31 },
  };
  const base = bases[archetype];
  return {
    lossAversion: clamp(base.lossAversion + jitter()),
    herding: clamp(base.herding + jitter()),
    ambition: clamp(base.ambition + jitter()),
    discipline: clamp(base.discipline + jitter()),
    patience: clamp(base.patience + jitter()),
    trust: clamp(base.trust + jitter()),
  };
}

export function generateCustomers(
  count = 300,
  seed = 20260830,
  marketShock: number = Math.abs(defaultScenario.marketShock),
): Customer[] {
  const random = mulberry32(seed);
  const shockPercent = Math.abs(marketShock) * 100;
  return Array.from({ length: count }, (_, index) => {
    const archetype = pickArchetype(random);
    const psychology = psychologyFor(archetype.name, random);
    const product = products[index % products.length];
    const volatility = productVolatility[product] ?? 1;
    const holdingBeta = clamp(
      0.62 + psychology.ambition * 0.42 + psychology.herding * 0.24 - psychology.discipline * 0.16 +
        (volatility - 1) * 0.55 + (random() - 0.5) * 0.12,
      0.35,
      1.9,
    );
    const idio = (random() - 0.5) * 3;
    const drawdown = clamp(shockPercent * holdingBeta + idio, 0.4, 45);
    const panic = initialPanic(shockPercent, psychology, drawdown);
    const influence = clamp(random() * 0.68 + psychology.herding * 0.25);
    const initial: Customer = {
      id: `C-${String(1001 + index).padStart(4, '0')}`,
      name: `${surnames[index % surnames.length]}**`,
      archetype: archetype.name,
      riskLevel: archetype.risk,
      product,
      productRisk: productRiskByProduct[product] ?? 3,
      drawdown: Number(drawdown.toFixed(1)),
      holdingBeta: Number(holdingBeta.toFixed(3)),
      influence,
      psychology,
      panic,
      buy: 0,
      hold: 0,
      sell: clamp(logistic((panic - 0.55) * 5 - psychology.discipline)),
      consult: 0,
      complaint: 0,
      churn: 0,
      priority: '低',
      peakPanic: 0,
      peakSell: 0,
      peakComplaint: 0,
      peakRisk: 0,
      peakStep: 0,
    };
    return { ...initial, ...behaviorProbabilities(initial) };
  });
}

export function matchesSegment(customer: Customer, segment: TargetSegment) {
  if (segment === 'all_customers') return true;
  return highVolatilityProducts.has(customer.product) && customer.holdingBeta >= segmentBetaThreshold;
}

const flatPsychology: Psychology = {
  lossAversion: 0.5,
  herding: 0.5,
  ambition: 0.5,
  discipline: 0.5,
  patience: 0.5,
  trust: 0.5,
};

function flattenPsychology(customers: Customer[], marketShock: number) {
  return customers.map((customer) => {
    const psychology = { ...flatPsychology };
    const panic = initialPanic(Math.abs(marketShock) * 100, psychology, customer.drawdown);
    const next: Customer = { ...customer, psychology, panic };
    return { ...next, ...behaviorProbabilities(next) };
  });
}

export type CustomerPool = {
  customers: Customer[];
  generatedCustomers: number;
  matchedCustomers: number;
  excludedCustomers: number;
  segmentRelaxed: boolean;
};

const maxPoolBlocks = 8;

export function buildCustomerPool(
  scenario: ScenarioConfig,
  ablations: Required<AblationFlags> = allAblationsOff,
): CustomerPool {
  const target = scenario.customerCount;
  const matched: Customer[] = [];
  const fallback: Customer[] = [];
  let generatedCustomers = 0;

  if (scenario.targetSegment === 'all_customers') {
    const customers = generateCustomers(target, scenario.seed, scenario.marketShock);
    return { customers, generatedCustomers: target, matchedCustomers: target, excludedCustomers: 0, segmentRelaxed: false };
  }

  for (let block = 0; block < maxPoolBlocks && matched.length < target; block += 1) {
    const customers = generateCustomers(target, scenario.seed + block * 1013, scenario.marketShock);
    customers.forEach((customer) => {
      (matchesSegment(customer, scenario.targetSegment) ? matched : fallback).push(customer);
    });
    generatedCustomers += target;
  }

  let segmentRelaxed = false;
  let selected = matched.slice(0, target);
  if (selected.length < target) {
    segmentRelaxed = true;
    const topUp = [...fallback].sort((a, b) => b.drawdown - a.drawdown).slice(0, target - selected.length);
    selected = [...selected, ...topUp];
  }

  const unique = selected.map((customer, index) => ({ ...customer, id: `C-${String(1001 + index).padStart(4, '0')}` }));
  const customers = ablations.disablePsychology ? flattenPsychology(unique, scenario.marketShock) : unique;

  return {
    customers,
    generatedCustomers,
    matchedCustomers: matched.length,
    excludedCustomers: generatedCustomers - matched.length,
    segmentRelaxed,
  };
}

export function generateRelationships(customers: Customer[], seed = 20260830): RelationshipEdge[] {
  const random = mulberry32(seed ^ 0x51f15e);
  const edges: RelationshipEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (source: Customer, target: Customer, type: RelationshipType, weight: number) => {
    if (source.id === target.id) return;
    const pair = [source.id, target.id].sort().join(':');
    const key = `${pair}:${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source: source.id, target: target.id, type, weight: clamp(weight, 0.15, 1) });
  };

  customers.forEach((customer, index) => {
    const sameArchetype = customers.filter((candidate) => candidate.archetype === customer.archetype && candidate.id !== customer.id);
    const sameProduct = customers.filter((candidate) => candidate.product === customer.product && candidate.id !== customer.id);
    const similar = sameArchetype[(index * 7 + 3) % Math.max(1, sameArchetype.length)];
    const servicePeer = sameProduct[(index * 5 + 1) % Math.max(1, sameProduct.length)];
    const socialPeer = customers[Math.floor(random() * customers.length)];
    if (similar) addEdge(customer, similar, 'similarity', 0.45 + random() * 0.3);
    if (socialPeer) addEdge(customer, socialPeer, 'social', 0.5 + customer.influence * 0.45);
    if (servicePeer) addEdge(customer, servicePeer, 'service', 0.35 + random() * 0.28);
  });
  return edges;
}

function buildAdjacency(customers: Customer[], relationships: RelationshipEdge[]) {
  const adjacency = new Map<string, Array<{ neighbor: string; type: RelationshipType; weight: number }>>();
  customers.forEach((customer) => adjacency.set(customer.id, []));
  relationships.forEach((edge) => {
    adjacency.get(edge.source)?.push({ neighbor: edge.target, type: edge.type, weight: edge.weight });
    adjacency.get(edge.target)?.push({ neighbor: edge.source, type: edge.type, weight: edge.weight });
  });
  return adjacency;
}

/**
 * 冲击形态：持续时间越长，压力衰减越慢、峰值越靠后。
 * ratio = 0（24 小时）时压力随步长衰减；ratio → 1（一周）时压力在窗口末端仍在累积。
 */
export function shockShape(durationHours: number, progress: number) {
  const ratio = clamp(Math.log(Math.max(durationHours, 1) / 24) / Math.log(7), 0, 1);
  const persistence = 1.02 + 0.16 * ratio;
  const spread = -0.22 + 0.3 * ratio;
  return persistence + spread * progress;
}

type StrategyRun = {
  result: Omit<StrategyResult, 'findings' | 'complianceRisk' | 'effectiveDraftText'>;
  customers: Customer[];
};

function runStrategy(
  baseCustomers: Customer[],
  relationships: RelationshipEdge[],
  strategy: (typeof strategyDefinitions)[number],
  scenario: ScenarioConfig,
  seed: number,
  ablations: Required<AblationFlags>,
): StrategyRun {
  const steps = scenario.timeSteps;
  const shockMagnitude = Math.abs(scenario.marketShock);
  const random = mulberry32(seed + strategy.id.length * 997);
  const customers = baseCustomers.map((customer) => ({
    ...customer,
    psychology: { ...customer.psychology },
  }));
  const snapshots: Snapshot[] = [];
  const customerStates: CustomerTimeState[][] = [];
  const adjacency = buildAdjacency(customers, relationships);
  const hoursPerStep = stepHours(scenario);

  for (const customer of customers) {
    const p = customer.psychology;
    customer.panic = clamp(
      customer.panic * 0.42 + shockMagnitude * (0.72 + p.lossAversion * 0.78) - p.discipline * 0.05,
    );
    Object.assign(customer, behaviorProbabilities(customer));
    customer.peakPanic = customer.panic;
    customer.peakSell = customer.sell;
    customer.peakComplaint = customer.complaint;
    customer.peakRisk = riskScoreOf(customer);
    customer.peakStep = 0;
  }
  let previousMeanPanic = customers.reduce((sum, customer) => sum + customer.panic, 0) / customers.length;

  for (let step = 1; step <= steps; step += 1) {
    const previousPanics = new Map(customers.map((customer) => [customer.id, customer.panic]));
    const progress = steps === 1 ? 0 : (step - 1) / (steps - 1);
    const marketStress = (0.095 + shockMagnitude * 0.82) * shockShape(scenario.durationHours, progress);
    let contagionTotal = 0;
    for (const customer of customers) {
      const p = customer.psychology;
      const targetedBoost = strategy.id === 'segmented'
        ? strategy.calming * (0.65 + p.trust * 0.45 + customer.influence * 0.15)
        : strategy.calming;
      const broadcastAlarm = strategy.id === 'broadcast'
        ? strategy.toneRisk * (p.lossAversion + p.herding)
        : 0;
      let neighborEffect = 0;
      if (!ablations.disableContagion) {
        const neighbors = adjacency.get(customer.id) ?? [];
        let weightedPanic = 0;
        let totalWeight = 0;
        neighbors.forEach((edge) => {
          const typeGain = edge.type === 'social' ? 1 : edge.type === 'similarity' ? 0.72 : strategy.id === 'segmented' ? 0.42 : 0.58;
          const weight = edge.weight * typeGain;
          weightedPanic += (previousPanics.get(edge.neighbor) ?? previousMeanPanic) * weight;
          totalWeight += weight;
        });
        const neighborPanic = totalWeight ? weightedPanic / totalWeight : previousMeanPanic;
        const propagationGain = 0.16 + shockMagnitude * 0.55;
        neighborEffect = neighborPanic * p.herding * propagationGain;
      }
      contagionTotal += neighborEffect;
      const noise = (random() - 0.5) * 0.035;
      const carriedPanic = ablations.disableMemory ? 0 : customer.panic * 0.56;
      customer.panic = clamp(
        carriedPanic +
          marketStress * p.lossAversion +
          neighborEffect +
          broadcastAlarm -
          targetedBoost -
          p.discipline * 0.09 -
          p.patience * 0.045 +
          noise,
      );
      p.trust = ablations.disableMemory
        ? clamp(customer.psychology.trust + strategy.trustLift * (progress + 0.45))
        : clamp(p.trust + strategy.trustLift * (0.45 + step / steps) - customer.panic * 0.012);
      Object.assign(customer, behaviorProbabilities(customer));
      customer.complaint = clamp(logistic((customer.panic - 0.62) * 4.2 - p.trust * 2.3 + strategy.toneRisk * 7) * 0.42);
      customer.churn = clamp(logistic((0.45 - p.trust) * 5 + customer.complaint * 2.2) * 0.38);
      const riskScore = riskScoreOf(customer);
      if (riskScore > customer.peakRisk) {
        customer.peakRisk = riskScore;
        customer.peakStep = step;
      }
      customer.peakPanic = Math.max(customer.peakPanic, customer.panic);
      customer.peakSell = Math.max(customer.peakSell, customer.sell);
      customer.peakComplaint = Math.max(customer.peakComplaint, customer.complaint);
      customer.priority = priorityOf(riskScore);
    }

    previousMeanPanic = customers.reduce((sum, customer) => sum + customer.panic, 0) / customers.length;
    const mean = (selector: (customer: Customer) => number) =>
      customers.reduce((sum, customer) => sum + selector(customer), 0) / customers.length;
    snapshots.push({
      step,
      stepHours: Number((step * hoursPerStep).toFixed(2)),
      panic: mean((customer) => customer.panic),
      buy: mean((customer) => customer.buy),
      hold: mean((customer) => customer.hold),
      sell: mean((customer) => customer.sell),
      consult: mean((customer) => customer.consult),
      complaint: mean((customer) => customer.complaint),
      churn: mean((customer) => customer.churn),
      trust: mean((customer) => customer.psychology.trust),
      coverage: clamp(strategy.coverage * (0.55 + step / steps * 0.52)),
      contagion: contagionTotal / customers.length,
    });
    customerStates.push(customers.map((customer) => ({
      id: customer.id,
      panic: customer.panic,
      trust: customer.psychology.trust,
      buy: customer.buy,
      hold: customer.hold,
      sell: customer.sell,
      consult: customer.consult,
      complaint: customer.complaint,
      churn: customer.churn,
      priority: customer.priority,
    })));
  }

  // 队列优先级按峰值暴露判定：期末状态在干预生效后普遍回落，无法反映客户需要被优先联系的程度。
  for (const customer of customers) {
    customer.priority = priorityOf(customer.peakRisk);
  }

  const last = snapshots[snapshots.length - 1];
  const peakPanic = Math.max(...snapshots.map((snapshot) => snapshot.panic));
  // 线性归一化（而非硬截断）：五个风险项与信任项的取值范围保证结果落在 [0,1]，
  // 且不会出现多个策略同时饱和到 1.0 导致推荐顺序随冲击大小翻转。
  const score = Number(
    (0.84 - peakPanic * 0.27 - last.sell * 0.25 - last.complaint * 0.2 - last.churn * 0.12 + last.trust * 0.16).toFixed(6),
  );
  return {
    result: {
      id: strategy.id,
      name: strategy.name,
      description: strategy.description,
      score,
      snapshots,
      customerStates,
      peakPanic,
      finalSell: last.sell,
      finalComplaint: last.complaint,
      finalChurn: last.churn,
      finalTrust: last.trust,
      draftText: strategy.draftText,
      macroPlan: buildMacroCommunicationPlan(strategy, scenario),
    },
    customers,
  };
}

function macroPlanText(plan: MacroCommunicationPlan) {
  return [
    plan.objective,
    plan.targetAudience,
    plan.cadence,
    plan.owner,
    plan.escalationRule,
    plan.guardrail,
    ...plan.phases.map((phase) => `${phase.name}（${phase.window}）：${phase.action}`),
  ].join('\n');
}

function complianceRiskOf(findings: ComplianceFinding[]): '低' | '中' | '高' {
  if (findings.some((finding) => finding.severity === '阻断')) return '高';
  if (findings.some((finding) => finding.severity === '警告')) return '中';
  return '低';
}

function representativeStates(customers: Customer[], states: CustomerTimeState[]) {
  const stride = Math.max(1, Math.floor(customers.length / 5));
  return customers
    .map((customer, index) => ({ customer, index }))
    .filter(({ index }) => index % stride === 0)
    .slice(0, 5)
    .map(({ customer, index }) => ({ customer, state: states[index] }));
}

export function runSimulation(scenario: ScenarioConfig = defaultScenario, options: SimulationOptions = {}): SimulationResult {
  // 真实计时：引擎耗时必须是实测值，不允许用规模公式估算。
  const startedAt = performance.now();
  const { customerCount, timeSteps: steps, seed } = scenario;
  const ablations: Required<AblationFlags> = { ...allAblationsOff, ...options.ablations };
  const pool = buildCustomerPool(scenario, ablations);
  const baseCustomers = pool.customers;
  const relationships = generateRelationships(baseCustomers, seed);
  const definitions = strategyDefinitions.map((definition) => {
    const draft = options.strategyDrafts?.find((item) => item.id === definition.id);
    if (!draft) return definition;
    const description = draft.description?.trim();
    const draftText = draft.draftText?.trim();
    return {
      ...definition,
      description: description ? description.slice(0, 60) : definition.description,
      draftText: draftText ? draftText.slice(0, 400) : definition.draftText,
    };
  });
  const runs = definitions.map((strategy, index) =>
    runStrategy(baseCustomers, relationships, strategy, scenario, seed + index * 101, ablations),
  );

  const reviewed = runs.map((run) => {
    const strategy = definitions.find((item) => item.id === run.result.id)!;
    if (ablations.disableCompliance) {
      return {
        result: { ...run.result, findings: [] as ComplianceFinding[], complianceRisk: '低' as const, effectiveDraftText: strategy.draftText },
        customers: run.customers,
      };
    }
    const states = run.result.customerStates[run.result.customerStates.length - 1] ?? [];
    const candidates: ComplianceCandidate[] = [
      { label: '策略草稿', text: strategy.draftText, scope: 'message', compliantAlternative: strategy.compliantDraftText },
      { label: '宏观方案', text: macroPlanText(run.result.macroPlan), scope: 'strategy' },
      ...representativeStates(baseCustomers, states).map(({ customer, state }) => ({
        label: `一人一策（${customer.archetype}）`,
        text: buildMicroCommunicationPlan(customer, state, scenario).recommendedMessage,
        scope: 'message' as const,
      })),
    ];
    const review = reviewCandidates(strategy.name, candidates);
    const suitability = new Map<string, ComplianceFinding>();
    baseCustomers.forEach((customer) => {
      const finding = suitabilityFinding(strategy.name, customer.riskLevel, customer.product, customer.productRisk);
      if (finding && !suitability.has(finding.rule)) suitability.set(finding.rule, finding);
    });
    const findings = [...review.findings, ...suitability.values()];
    return {
      result: {
        ...run.result,
        findings,
        complianceRisk: complianceRiskOf(findings),
        effectiveDraftText: review.effectiveTexts[0] ?? strategy.draftText,
      },
      customers: run.customers,
    };
  });

  const strategies = reviewed.map((run) => run.result).sort((a, b) => b.score - a.score);
  const recommended = strategies[0].id;
  const recommendedRun = reviewed.find((run) => run.result.id === recommended) ?? reviewed[0];
  const findings = recommendedRun.result.findings;
  const allFindings = reviewed.flatMap((run) => run.result.findings);
  const blockedFindings = allFindings.filter((finding) => finding.severity === '阻断');
  const reviewFindings = allFindings.filter((finding) => finding.severity === '警告');
  const averageDrawdown = baseCustomers.reduce((sum, customer) => sum + customer.drawdown, 0) / customerCount;

  const audit: AuditEntry[] = [
    { seq: 1, actor: 'Planner', action: '解析并拆解业务目标', result: `市场冲击 ${(scenario.marketShock * 100).toFixed(0)}%、持续 ${scenario.durationHours} 小时（每步 ${stepHours(scenario).toFixed(1)} 小时）、目标客群 ${segmentCriteria(scenario.targetSegment)}`, status: 'completed' },
    { seq: 2, actor: 'CustomerQueryTool', action: '筛选目标客户', result: `候选客户 ${pool.generatedCustomers} 名，客群口径命中 ${pool.matchedCustomers} 名，选取 ${customerCount} 名${pool.segmentRelaxed ? '（命中不足，已按回撤降序补足并标注）' : ''}`, status: pool.segmentRelaxed ? 'pending' : 'completed' },
    { seq: 3, actor: 'ProfileTool', action: '构建行为画像', result: `5 类原型、6 个心理因素，平均持仓回撤 ${averageDrawdown.toFixed(1)}%，随机种子 ${seed}`, status: 'completed' },
    { seq: 4, actor: 'RelationshipTool', action: '构建客户关系网络', result: `${relationships.length} 条关系边、3 类传播通道`, status: 'completed' },
    { seq: 5, actor: 'StrategyTool', action: '生成候选沟通策略', result: `${definitions.length} 套候选策略，草稿文本已提交合规审查`, status: 'completed' },
    { seq: 6, actor: 'SimulationTool', action: '执行群体模拟', result: `${steps} 个时间步、市场冲击 ${(scenario.marketShock * 100).toFixed(0)}%、每步 ${stepHours(scenario).toFixed(1)} 小时、随机种子 ${seed}`, status: 'completed' },
    { seq: 7, actor: 'PolicyGateway', action: '合规审查', result: `${blockedFindings.length} 项阻断、${reviewFindings.length} 项待审批，规则版本 ${RULE_VERSION}`, status: blockedFindings.length ? 'blocked' : reviewFindings.length ? 'pending' : 'completed' },
    { seq: 8, actor: 'Reflector', action: '生成反思与候选技能', result: `推荐策略「${strategies[0].name}」，得分 ${(strategies[0].score * 100).toFixed(1)}，可沉淀为候选 Skill`, status: 'completed' },
  ];

  return {
    scenario,
    scenarioMeta: {
      stepHours: Number(stepHours(scenario).toFixed(3)),
      segment: scenario.targetSegment,
      segmentCriteria: segmentCriteria(scenario.targetSegment),
      generatedCustomers: pool.generatedCustomers,
      excludedCustomers: pool.excludedCustomers,
      segmentRelaxed: pool.segmentRelaxed,
      ruleVersion: RULE_VERSION,
      ablations,
    },
    seed,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    customerCount,
    relationships,
    customers: [...recommendedRun.customers].sort((a, b) => {
      const priority = { 高: 3, 中: 2, 低: 1 };
      return priority[b.priority] - priority[a.priority] || b.influence - a.influence;
    }),
    strategies,
    recommended,
    findings,
    explanationFactors: [
      {
        label: '市场损失冲击',
        weight: clamp(Math.abs(scenario.marketShock) / 0.35),
        evidence: `市场跌幅 ${(Math.abs(scenario.marketShock) * 100).toFixed(0)}% 按持仓弹性逐客户换算为回撤，平均 ${averageDrawdown.toFixed(1)}%。`,
        direction: '风险上升',
      },
      {
        label: '损失厌恶',
        weight: baseCustomers.reduce((sum, customer) => sum + customer.psychology.lossAversion, 0) / customerCount,
        evidence: '来自五类客户原型的心理参数均值，并按客户逐一计算。',
        direction: '风险上升',
      },
      {
        label: '关系网络传播',
        weight: baseCustomers.reduce((sum, customer) => sum + customer.psychology.herding, 0) / customerCount,
        evidence: `${relationships.length} 条相似性、社交影响和统一服务关系边参与邻居状态更新。`,
        direction: '风险上升',
      },
      {
        label: '持续时间压力',
        weight: clamp(Math.log(Math.max(scenario.durationHours, 1) / 24) / Math.log(7), 0, 1),
        evidence: `事件持续 ${scenario.durationHours} 小时、每步 ${stepHours(scenario).toFixed(1)} 小时；持续时间越长压力衰减越慢、峰值越靠后。`,
        direction: '风险上升',
      },
      {
        label: '分群干预缓释',
        weight: definitions.find((strategy) => strategy.id === recommended)?.calming ?? 0,
        evidence: '按风险偏好、机构信任和网络影响力调整干预强度。',
        direction: '风险缓释',
      },
      {
        label: '合规硬边界',
        weight: clamp((blockedFindings.length * 2 + reviewFindings.length) / 6),
        evidence: `${blockedFindings.length} 项阻断已改写或拦截、${reviewFindings.length} 项待审批，规则版本 ${RULE_VERSION}。`,
        direction: '风险缓释',
      },
    ],
    audit,
  };
}

/** 聚合签名：用于确定性回归测试与审计留痕。 */
export function aggregateSignature(result: SimulationResult) {
  const strategies = result.strategies.map((strategy) => [
    strategy.id,
    strategy.score.toFixed(6),
    strategy.peakPanic.toFixed(6),
    strategy.finalSell.toFixed(6),
    strategy.finalComplaint.toFixed(6),
    strategy.finalChurn.toFixed(6),
    strategy.snapshots.map((snapshot) => `${snapshot.step}:${snapshot.panic.toFixed(6)}`).join(','),
  ].join('|'));
  return `${result.scenario.targetSegment}|${result.seed}|${result.customerCount}|${result.relationships.length}|${strategies.join('||')}`;
}

export function percent(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}
