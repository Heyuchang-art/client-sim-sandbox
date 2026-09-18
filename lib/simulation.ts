import {
  RULE_VERSION,
  checkSuitability,
  productRiskByProduct,
  reviewCandidates,
  severityLabels,
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
  /** 排序依据：避险收益 − 触达成本 − 唤醒效应，由场景与业务权重共同计算。 */
  score: number;
  /** 效用的三项归因分解，用于向业务方解释推荐理由。 */
  utility: StrategyUtility;
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
  /** 业务效用权重：由目标决定更看重避险、预算还是客户体验；缺省按避险优先。 */
  utilityWeights?: Partial<UtilityWeights>;
  /** 是否在同一参数空间上做网格搜索。默认关闭，由 API 与异步任务显式开启。 */
  searchSpace?: boolean;
};

/** 参数空间网格搜索的结果，用于说明三套锚点并非唯一可选方案。 */
/**
 * 参数空间网格搜索的结果，用于说明三套锚点并非唯一可选方案。
 *
 * 重要区分：搜索结果**不是可执行推荐**。搜索点只按参数直接评估，既没有生成草稿文本，
 * 也没有经过 Policy Gateway 审查，因此净效用可能高于推荐锚点。界面必须同时展示这一
 * 差异并说明原因，不能把搜索点当成系统推荐，否则会出现「推荐了一个自己算出来更差的方案」
 * 的矛盾。
 */
export type StrategySearchOutcome = {
  evaluated: number;
  best: { levers: StrategyLevers; utility: StrategyUtility } | null;
  top: Array<{ levers: StrategyLevers; utility: StrategyUtility }>;
  /** 固定为 false：搜索点未经草稿生成与合规审查，不可直接执行。 */
  executable: false;
  note: string;
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
  /** 本次生效的效用权重，随结果一并留痕。 */
  utilityWeights: UtilityWeights;
  strategySearch: StrategySearchOutcome | null;
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

/** 策略的三个可调杠杆：其余引擎参数由它们推导，避免出现互相矛盾的独立常数。 */
export type StrategyLevers = {
  /** 触达覆盖率：事件窗口内最终能触达的客户比例。 */
  reach: number;
  /** 人工深度：0 为纯自动消息，1 为逐人人工沟通。 */
  depth: number;
  /** 内容个性化程度：0 为通用话术，1 为逐人定制。 */
  personalize: number;
};

/** 由杠杆推导出的引擎参数。 */
export type StrategyParams = StrategyLevers & {
  /** 达到目标覆盖率所需步数，反映人工作业的排队时间。 */
  rampSteps: number;
  /** 唤醒系数：主动触达本身引起的额外关注与焦虑。 */
  wake: number;
  /** 话术风险：绝对化、催促类表达带来的情绪放大效应。 */
  toneRisk: number;
};

export type StrategyDefinition = StrategyParams & {
  id: StrategyId;
  name: string;
  description: string;
  draftText: string;
  compliantDraftText: string;
};

/**
 * 由三个杠杆推导其余参数。
 * - 人工深度决定爬坡步数：越依赖逐人沟通，越需要时间铺开。
 * - 个性化程度决定唤醒强度：通用群发比定制沟通更容易惊动客户。
 * - 话术风险来自「通用 + 大范围触达」的组合，即缺少个性化又覆盖面广时最危险。
 */
export function deriveStrategyParams(levers: StrategyLevers): StrategyParams {
  const { reach, depth, personalize } = levers;
  return {
    ...levers,
    rampSteps: depth <= 0 ? 1 : Math.round(clamp(1 + depth * 7, 1, 6)),
    wake: Number((0.05 * (1 - 0.54 * personalize)).toFixed(4)),
    toneRisk: Number((0.055 * (1 - personalize) * clamp(reach * 1.05)).toFixed(4)),
  };
}

/**
 * 三套锚点策略只是参数空间里的三个点，排序由引擎按场景计算得出，
 * 不由常数预先决定——这是「策略比较」能够产生不同结论的前提。
 */
export const strategyAnchors: Array<{ id: StrategyId; name: string; description: string; levers: StrategyLevers; draftText: string; compliantDraftText: string }> = [
  {
    id: 'baseline',
    name: '不主动沟通',
    description: '保持现状，仅响应客户主动咨询。',
    levers: { reach: 0.08, depth: 0, personalize: 0 },
    draftText: '本次市场调整期间不主动触达客户，等待客户主动咨询后再提供标准风险说明。',
    compliantDraftText: '本次市场调整期间不主动触达客户，等待客户主动咨询后再提供标准风险说明。',
  },
  {
    id: 'broadcast',
    name: '统一风险提示',
    description: '向全部目标客户发送统一的市场风险通知。',
    levers: { reach: 0.95, depth: 0.05, personalize: 0.1 },
    draftText: '向全部目标客户统一推送：请务必立即行动锁定收益，本轮调整后一定反弹，不要错过这次机会。',
    compliantDraftText: '向全部目标客户统一推送市场风险说明：解释本次下跌原因与产品波动特征，提示风险并提供人工服务入口，不包含催促、收益判断或反弹预期。',
  },
  {
    id: 'segmented',
    name: '分群差异化沟通',
    description: '按风险偏好与心理特征生成差异化内容，优先干预关键节点。',
    levers: { reach: 0.86, depth: 0.45, personalize: 0.9 },
    draftText: '按客户风险等级与心理特征分群触达，优先人工干预高影响节点，先说明风险再给选项。',
    compliantDraftText: '按客户风险等级与心理特征分群触达，优先人工干预高影响节点，先说明风险再给选项。',
  },
];

export const strategyDefinitions: StrategyDefinition[] = strategyAnchors.map((anchor) => ({
  ...deriveStrategyParams(anchor.levers),
  id: anchor.id,
  name: anchor.name,
  description: anchor.description,
  draftText: anchor.draftText,
  compliantDraftText: anchor.compliantDraftText,
}));

/** 一次人工沟通的等效成本（以一条自动消息为 1）。 */
export const depthCostFactor = 24;
/** 成本归一化基准，使成本项与避险收益处于同一量级。 */
const costNormalization = 10;

/**
 * 效用权重：由业务目标决定（更怕流失、更怕预算超支，还是更怕打扰客户）。
 *
 * 需要如实说明：避险收益（风险改善）与触达成本（预算）量纲不同，把两者相加必然需要一个
 * 兑换率，而这个兑换率无法从合成数据里估计，只能由业务方设定。因此它是**业务参数**而非
 * 模型参数，处理方式如下：
 * - 界面上暴露实际取值，并随结果、审计与指标快照一同留痕；
 * - 对本项目的结论只使用与权重无关的结构性质（跌幅越大、推荐方案的人工深度不下降等），
 *   这些性质在任何权重下都必须成立，见 `npm run eval:strategies`；
 * - 三种锚点的夺冠占比会随权重变化，只能连同敏感性曲面一起引用，不能单独当作发现。
 * - cost：触达预算，以「一条自动消息」为单位；一次人工沟通按 depthCostFactor 折算。
 * - wake：客户打扰成本（体验与品牌），与恐慌通道分开计，代表过度触达的独立代价。
 */
export type UtilityWeights = {
  avoid: number;
  cost: number;
  wake: number;
};

export const defaultUtilityWeights: UtilityWeights = { avoid: 1, cost: 0.1, wake: 2 };

/** 效用归因分解：三项之和即策略排序依据，可向评委逐项解释。 */
export type StrategyUtility = {
  /** 相对「不主动沟通」基线的避险收益，由恐慌、卖出、流失、投诉四项改善加权得到。 */
  avoidance: number;
  /** 归一化触达成本。 */
  cost: number;
  /** 唤醒效应总量。 */
  wake: number;
  total: number;
};

function buildMacroCommunicationPlan(strategy: StrategyDefinition, scenario: ScenarioConfig): MacroCommunicationPlan {
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
// 产品风险等级统一取自合规规则模块（lib/compliance/rules.ts），避免两处口径不一致。
const highVolatilityProducts = new Set(['科技成长组合', '量化增强产品', '新能源主题基金']);
const surnames = ['陈', '李', '王', '张', '刘', '周', '徐', '许', '郑', '顾', '沈', '林'];

const riskLevelOrder: Array<Customer['riskLevel']> = ['C1', 'C2', 'C3', 'C4', 'C5'];

/** 因历史持仓或风险测评过期而越级持有产品的客户比例。 */
export const overreachRate = 0.12;

/** 风险承受等级的归一化位置：C1 = 0，C5 = 1。 */
function riskTierOf(customer: Customer) {
  return riskLevelOrder.indexOf(customer.riskLevel) / (riskLevelOrder.length - 1);
}

/**
 * 适当性匹配的产品分配：多数客户持有风险等级不高于自身承受等级的产品；
 * 少数客户因历史原因越级持有，这部分构成随客户结构变化的存量适当性风险。
 */
function pickProduct(risk: Customer['riskLevel'], random: () => number) {
  const tolerance = riskLevelOrder.indexOf(risk) + 1;
  const eligible = products.filter((product) => (productRiskByProduct[product] ?? 3) <= tolerance);
  const beyond = products.filter((product) => (productRiskByProduct[product] ?? 3) > tolerance);
  if (beyond.length > 0 && random() < overreachRate) {
    return beyond[Math.floor(random() * beyond.length)];
  }
  return eligible[Math.floor(random() * eligible.length)];
}

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
    // 适当性匹配：多数客户持有风险等级不高于自身承受等级的产品。
    const product = pickProduct(archetype.risk, random);
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

/**
 * 关闭心理层的消融：六维心理参数取中性值，并**一并重算**由心理参数派生的
 * 持仓弹性与回撤。否则心理层仍会通过持仓弹性继续影响结果，消融不彻底。
 * 中性参数下不再叠加个体扰动，以便该层能被干净地移除。
 */
function flattenPsychology(customers: Customer[], marketShock: number) {
  return customers.map((customer) => {
    const psychology = { ...flatPsychology };
    const volatility = productVolatility[customer.product] ?? 1;
    const holdingBeta = clamp(
      0.62 + psychology.ambition * 0.42 + psychology.herding * 0.24 - psychology.discipline * 0.16 + (volatility - 1) * 0.55,
      0.35,
      1.9,
    );
    const drawdown = clamp(Math.abs(marketShock) * 100 * holdingBeta, 0.4, 45);
    const panic = initialPanic(Math.abs(marketShock) * 100, psychology, drawdown);
    const next: Customer = {
      ...customer,
      psychology,
      panic,
      holdingBeta: Number(holdingBeta.toFixed(3)),
      drawdown: Number(drawdown.toFixed(1)),
    };
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
 * 冲击形态：持续时间越长，压力越持久、衰减越慢。
 * ratio 的定义域覆盖 1 小时到一周，因此短于 24 小时的冲击也会更快衰减，
 * 不会与 24 小时场景得到同一条压力曲线。
 *
 * 需要如实说明的限制：在现有参数下压力随步长单调衰减，因此压力峰值出现在
 * 首个时间步，「时长越长峰值越靠后」并不成立；时长的影响体现在峰值高度与
 * 衰减速度上。
 */
export function shockShape(durationHours: number, progress: number) {
  const ratio = clamp(Math.log(Math.max(durationHours, 1) / 24) / Math.log(24), -1, 1);
  const persistence = 1.02 + 0.16 * ratio;
  const spread = -0.22 + 0.3 * ratio;
  return persistence + spread * progress;
}

/** 策略在数值层面的原始产出；效用由 runSimulation 统一按基线对比计算。 */
export type StrategyMetrics = {
  peakPanic: number;
  finalSell: number;
  finalComplaint: number;
  finalChurn: number;
  finalTrust: number;
  /** 归一化触达成本，与避险收益同量级。 */
  touchCost: number;
  /** 唤醒效应总量。 */
  wake: number;
  /** 期末实际触达覆盖率。 */
  coverage: number;
  /** 违规话术通道是否已被 Policy Gateway 清除。 */
  toneSuppressed: boolean;
};

type StrategyRun = {
  result: Omit<StrategyResult, 'findings' | 'complianceRisk' | 'effectiveDraftText'>;
  customers: Customer[];
  metrics: StrategyMetrics;
};

function runStrategy(
  baseCustomers: Customer[],
  relationships: RelationshipEdge[],
  strategy: StrategyDefinition,
  scenario: ScenarioConfig,
  seed: number,
  ablations: Required<AblationFlags>,
  toneRisk: number,
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
  const unitCost = 1 + depthCostFactor * strategy.depth;

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
  let touchCostTotal = 0;
  let wakeTotal = 0;
  let reachTotal = 0;

  for (let step = 1; step <= steps; step += 1) {
    const previousPanics = new Map(customers.map((customer) => [customer.id, customer.panic]));
    // 触达目标在本步更新前统一计算，避免同一时间步内的遍历顺序影响结果。
    const focusByCustomer = new Map<string, number>();
    for (const customer of customers) {
      focusByCustomer.set(customer.id, clamp(0.6 + (riskScoreOf(customer) - 0.25) * 1.6, 0.5, 1.25));
    }

    const ramp = strategy.rampSteps <= 0 ? 1 : clamp(step / strategy.rampSteps);
    const priorRamp = strategy.rampSteps <= 0 ? 1 : clamp((step - 1) / strategy.rampSteps);
    const progress = steps === 1 ? 0 : (step - 1) / (steps - 1);
    const marketStress = (0.095 + shockMagnitude * 0.82) * shockShape(scenario.durationHours, progress);
    let contagionTotal = 0;
    for (const customer of customers) {
      const p = customer.psychology;
      const priorPanic = previousPanics.get(customer.id) ?? customer.panic;
      // 逐客户触达门控：覆盖率只作用于真正被触达的客户，人工深度决定铺开速度。
      const focus = focusByCustomer.get(customer.id) ?? 1;
      const reached = clamp(strategy.reach * focus * ramp);
      const newlyReached = clamp(reached - clamp(strategy.reach * focus * priorRamp));
      // 个性化程度决定通用话术对风险两端客户的失配：越通用，越贴合不上极端客户。
      const extremity = Math.abs(riskTierOf(customer) - 0.5) * 2;
      const fit = 1 - (1 - strategy.personalize) * extremity * 0.8;
      // 安抚由两部分构成：广覆盖带来的「信息真空填补」，以及个性化带来的贴合度。
      // 前者解释为什么统一提示也有效，后者解释为什么高冲击下需要分群。
      // 安抚由两部分构成：广覆盖带来的「信息真空填补」，以及个性化带来的贴合度。
      // 再乘以「冲击紧迫度」——市场真的在跌时安抚才有价值，微跌时触达本身更像打扰。
      const urgency = 0.45 + shockMagnitude * 2.2;
      const boost = reached * urgency * (0.09 * (1 - strategy.personalize) + 0.22 * strategy.personalize * fit + 0.1 * strategy.depth);
      const trustGain = reached * (0.015 * (1 - strategy.personalize) + 0.03 * strategy.personalize * fit + 0.02 * strategy.depth);
      const alarm = toneRisk * (p.lossAversion + p.herding);
      // 唤醒效应：主动触达会让原本平静的客户开始关注账户，覆盖面铺开得越快越明显。
      const wake = strategy.wake * (1 - priorPanic) * newlyReached;
      reachTotal += reached;
      wakeTotal += wake;
      touchCostTotal += unitCost * reached;

      let neighborEffect = 0;
      if (!ablations.disableContagion) {
        const neighbors = adjacency.get(customer.id) ?? [];
        let weightedPanic = 0;
        let totalWeight = 0;
        neighbors.forEach((edge) => {
          const typeGain = edge.type === 'social' ? 1 : edge.type === 'similarity' ? 0.72 : strategy.depth > 0.2 ? 0.42 : 0.58;
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
          alarm +
          wake -
          boost -
          p.discipline * 0.09 -
          p.patience * 0.045 +
          noise,
      );
      p.trust = ablations.disableMemory
        ? clamp(customer.psychology.trust + trustGain * (progress + 0.45))
        : clamp(p.trust + trustGain - customer.panic * 0.012);
      Object.assign(customer, behaviorProbabilities(customer));
      customer.complaint = clamp(logistic((customer.panic - 0.62) * 4.2 - p.trust * 2.3 + toneRisk * 7) * 0.42);
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
      coverage: clamp(reachTotal / (customers.length * step)),
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
  return {
    result: {
      id: strategy.id,
      name: strategy.name,
      description: strategy.description,
      // 得分与归因由 runSimulation 在拿到基线后统一计算，此处不预设。
      score: 0,
      utility: { avoidance: 0, cost: 0, wake: 0, total: 0 },
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
    metrics: {
      peakPanic,
      finalSell: last.sell,
      finalComplaint: last.complaint,
      finalChurn: last.churn,
      finalTrust: last.trust,
      touchCost: Number((touchCostTotal / (customers.length * steps * costNormalization)).toFixed(6)),
      wake: Number((wakeTotal / customers.length).toFixed(6)),
      coverage: last.coverage,
      toneSuppressed: toneRisk === 0 && strategy.toneRisk > 0,
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

/**
 * 存量适当性风险：客户自身持仓的风险等级超出其风险承受等级。
 * 受影响客户数随客户结构与随机种子变化，因此该发现不再是各场景恒定的一条。
 */
function suitabilityFindings(strategy: string, customers: Customer[]): ComplianceFinding[] {
  const gapOf = (customer: Customer) => customer.productRisk - (riskLevelOrder.indexOf(customer.riskLevel) + 1);
  const groups = [
    {
      list: customers.filter((customer) => checkSuitability(customer.riskLevel, customer.productRisk) === 'block'),
      rule: 'SUITABILITY-MATRIX-01',
      severity: 'block' as const,
      title: '存量持仓超越客户风险承受等级',
    },
    {
      list: customers.filter((customer) => checkSuitability(customer.riskLevel, customer.productRisk) === 'review'),
      rule: 'SUITABILITY-MATRIX-02',
      severity: 'review' as const,
      title: '存量持仓高于客户风险承受等级一档',
    },
  ];
  return groups
    .filter((group) => group.list.length > 0)
    .map((group) => {
      const worst = group.list.reduce((best, customer) => (gapOf(customer) > gapOf(best) ? customer : best), group.list[0]);
      const share = ((group.list.length / customers.length) * 100).toFixed(1);
      return {
        id: `${strategy}-${group.rule}`,
        rule: group.rule,
        title: group.title,
        severity: severityLabels[group.severity],
        strategy,
        detail: `目标客群中 ${group.list.length} 名客户（占 ${share}%）持有的产品风险等级超出其风险承受等级，最严重一例为 ${worst.id}（${worst.riskLevel} 客户 × ${worst.product} R${worst.productRisk}）。`,
        evidence: `${group.list.length}/${customers.length} 名客户持仓与风险承受等级不匹配`,
        excerpt: '',
        index: -1,
        length: 0,
        status: '待审批' as const,
        ruleVersion: RULE_VERSION,
      };
    });
}

function representativeStates(customers: Customer[], states: CustomerTimeState[]) {
  const stride = Math.max(1, Math.floor(customers.length / 5));
  return customers
    .map((customer, index) => ({ customer, index }))
    .filter(({ index }) => index % stride === 0)
    .slice(0, 5)
    .map(({ customer, index }) => ({ customer, state: states[index] }));
}

/**
 * 参数空间网格：三套锚点只是这个空间里的三个点。
 * 搜索体现「引擎能算出的更优参数组合」，而不是预先写死的推荐顺序。
 */
export function strategyLeversGrid(): StrategyLevers[] {
  const grid: StrategyLevers[] = [];
  for (const reach of [0.25, 0.6, 0.95]) {
    for (const depth of [0, 0.25, 0.5]) {
      for (const personalize of [0, 0.45, 0.9]) {
        grid.push({ reach, depth, personalize });
      }
    }
  }
  return grid;
}

/**
 * 效用以「不主动沟通」为参照系：避险收益是相对基线的改善量，
 * 成本与唤醒是这次干预自身带来的代价。三项分开输出，可逐项向业务方解释。
 */
function utilityFrom(metrics: StrategyMetrics, baseline: StrategyMetrics, weights: UtilityWeights): StrategyUtility {
  const avoidance =
    0.3 * (baseline.peakPanic - metrics.peakPanic) +
    0.3 * (baseline.finalSell - metrics.finalSell) +
    0.25 * (baseline.finalChurn - metrics.finalChurn) +
    0.15 * (baseline.finalComplaint - metrics.finalComplaint);
  return {
    avoidance: Number(avoidance.toFixed(6)),
    cost: metrics.touchCost,
    wake: metrics.wake,
    total: Number((weights.avoid * avoidance - weights.cost * metrics.touchCost - weights.wake * metrics.wake).toFixed(6)),
  };
}

/**
 * 在「触达覆盖率 × 人工深度 × 内容个性化」三维空间上做网格搜索。
 * 搜索点不带草稿文本，其话术参数直接取推导值；任何上线方案仍需通过 Policy Gateway。
 */
function searchStrategySpace(
  baseCustomers: Customer[],
  relationships: RelationshipEdge[],
  scenario: ScenarioConfig,
  seed: number,
  ablations: Required<AblationFlags>,
  weights: UtilityWeights,
  baseline: StrategyMetrics,
  recommended: StrategyResult,
): StrategySearchOutcome {
  const evaluated = strategyLeversGrid().map((levers, index) => {
    const params = deriveStrategyParams(levers);
    const run = runStrategy(
      baseCustomers,
      relationships,
      {
        ...params,
        id: 'segmented',
        name: `参数搜索点 ${index + 1}`,
        description: '参数空间网格搜索候选点。',
        draftText: '',
        compliantDraftText: '',
      },
      scenario,
      seed + 977 + index * 131,
      ablations,
      params.toneRisk,
    );
    return { levers, utility: utilityFrom(run.metrics, baseline, weights) };
  });
  const ranked = [...evaluated].sort((a, b) => b.utility.total - a.utility.total);
  const best = ranked[0] ?? null;
  return {
    evaluated: ranked.length,
    best,
    top: ranked.slice(0, 3),
    executable: false,
    note: best && best.utility.total > recommended.utility.total
      ? `搜索最优组合的净效用 ${(best.utility.total * 100).toFixed(2)} 高于推荐锚点「${recommended.name}」的 ${(recommended.utility.total * 100).toFixed(2)}。搜索点尚未生成草稿文本、也未经 Policy Gateway 审查，因此不直接作为推荐；如需落地，应先为其起草文案并送审。`
      : `搜索最优组合的净效用未超过推荐锚点「${recommended.name}」，推荐保持为已通过合规审查的锚点方案。`,
  };
}

export function runSimulation(scenario: ScenarioConfig = defaultScenario, options: SimulationOptions = {}): SimulationResult {
  // 真实计时：引擎耗时必须是实测值，不允许用规模公式估算。
  const startedAt = performance.now();
  const { customerCount, timeSteps: steps, seed } = scenario;
  const ablations: Required<AblationFlags> = { ...allAblationsOff, ...options.ablations };
  const weights: UtilityWeights = { ...defaultUtilityWeights, ...options.utilityWeights };
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

  // 合规属于硬边界，因此草稿审查前置于数值模拟：
  // 被拦截的违规表达不会发出去，其情绪放大效应也不应计入行为推演。
  const draftReviews = new Map<StrategyId, { blocked: boolean; findings: ComplianceFinding[]; effectiveText: string }>();
  definitions.forEach((definition) => {
    if (ablations.disableCompliance) {
      draftReviews.set(definition.id, { blocked: false, findings: [], effectiveText: definition.draftText });
      return;
    }
    const review = reviewCandidates(definition.name, [
      {
        label: '策略草稿',
        text: definition.draftText,
        scope: 'message',
        compliantAlternative: definition.compliantDraftText,
      },
    ]);
    draftReviews.set(definition.id, {
      blocked: review.findings.some((finding) => finding.severity === '阻断'),
      findings: review.findings.filter((finding) => finding.status === '已拦截'),
      effectiveText: review.effectiveTexts[0] ?? definition.draftText,
    });
  });

  const runs = definitions.map((strategy, index) => {
    const review = draftReviews.get(strategy.id)!;
    // 被拦截的话术风险通道归零：违规表达没有发出，其放大效应不再发生。
    const toneRisk = review.blocked ? 0 : strategy.toneRisk;
    return runStrategy(baseCustomers, relationships, strategy, scenario, seed + index * 101, ablations, toneRisk);
  });

  const baselineMetrics = runs[0].metrics;
  const reviewed = runs.map((run) => {
    const strategy = definitions.find((item) => item.id === run.result.id)!;
    const draft = draftReviews.get(strategy.id)!;
    if (ablations.disableCompliance) {
      return {
        ...run,
        findings: [] as ComplianceFinding[],
        complianceRisk: '低' as const,
        effectiveDraftText: strategy.draftText,
      };
    }
    const states = run.result.customerStates[run.result.customerStates.length - 1] ?? [];
    const candidates: ComplianceCandidate[] = [
      { label: '宏观方案', text: macroPlanText(run.result.macroPlan), scope: 'strategy' },
      ...representativeStates(baseCustomers, states).map(({ customer, state }) => ({
        label: `一人一策（${customer.archetype}）`,
        text: buildMicroCommunicationPlan(customer, state, scenario).recommendedMessage,
        scope: 'message' as const,
      })),
    ];
    const review = reviewCandidates(strategy.name, candidates);
    const findings = [...draft.findings, ...review.findings, ...suitabilityFindings(strategy.name, baseCustomers)];
    return {
      ...run,
      findings,
      complianceRisk: complianceRiskOf(findings),
      effectiveDraftText: draft.effectiveText,
    };
  });

  const strategies: StrategyResult[] = reviewed
    .map((run) => {
      const utility = utilityFrom(run.metrics, baselineMetrics, weights);
      return {
        ...run.result,
        findings: run.findings,
        complianceRisk: run.complianceRisk,
        effectiveDraftText: run.effectiveDraftText,
        score: utility.total,
        utility,
      };
    })
    .sort((a, b) => b.score - a.score);
  const recommended = strategies[0].id;
  const recommendedRun = reviewed.find((run) => run.result.id === recommended) ?? reviewed[0];

  // 合规发现按全部候选策略汇总：只统计推荐策略会隐藏其他策略的真实命中。
  const seenFinding = new Set<string>();
  const findings = strategies
    .flatMap((strategy) => strategy.findings)
    .filter((finding) => {
      if (seenFinding.has(finding.id)) return false;
      seenFinding.add(finding.id);
      return true;
    });
  const blockedFindings = findings.filter((finding) => finding.severity === '阻断');
  const reviewFindings = findings.filter((finding) => finding.severity === '警告');
  const blockedDrafts = [...draftReviews.values()].filter((review) => review.blocked).length;
  const averageDrawdown = baseCustomers.reduce((sum, customer) => sum + customer.drawdown, 0) / customerCount;
  const recommendedStrategy = definitions.find((definition) => definition.id === recommended) ?? definitions[0];
  const recommendedUtility = strategies[0].utility;

  /**
   * 审计轨迹与界面必须同口径：界面把四项都换算成相对「不主动沟通」的分值，
   * 这里也按同一规则换算，成本与打扰同样以负值表示扣分项，
   * 否则展开执行记录的人会看到与主表矛盾的推荐度。
   */
  const baselineTotal = -weights.cost * baselineMetrics.touchCost - weights.wake * baselineMetrics.wake;
  const relativeUtility = (utility: StrategyUtility) => ({
    total: (utility.total - baselineTotal) * 100,
    avoidance: utility.avoidance * 100,
    cost: -weights.cost * (utility.cost - baselineMetrics.touchCost) * 100,
    wake: -weights.wake * (utility.wake - baselineMetrics.wake) * 100,
  });

  const strategySearch = options.searchSpace
    ? searchStrategySpace(baseCustomers, relationships, scenario, seed, ablations, weights, baselineMetrics, strategies[0])
    : null;

  const audit: AuditEntry[] = [
    { seq: 1, actor: '任务规划', action: '理解你的目标', result: `跌幅 ${(scenario.marketShock * 100).toFixed(0)}%、持续 ${scenario.durationHours} 小时（每段 ${stepHours(scenario).toFixed(1)} 小时）、目标客户 ${segmentCriteria(scenario.targetSegment)}`, status: 'completed' },
    { seq: 2, actor: '客户筛选', action: '筛出目标客户', result: `共生成候选客户 ${pool.generatedCustomers} 名，符合条件 ${pool.matchedCustomers} 名，本次选取 ${customerCount} 名${pool.segmentRelaxed ? '（符合条件的不足，已按回撤从高到低补足并标注）' : ''}`, status: pool.segmentRelaxed ? 'pending' : 'completed' },
    { seq: 3, actor: '客户画像', action: '整理客户情况', result: `5 类客户画像、6 项心理特征，平均持仓回撤 ${averageDrawdown.toFixed(1)}%，随机种子 ${seed}`, status: 'completed' },
    { seq: 4, actor: '关系网络', action: '建立客户联系', result: `共 ${relationships.length} 条客户联系、3 种影响渠道`, status: 'completed' },
    { seq: 5, actor: '方案起草', action: '起草沟通方案', result: `${definitions.length} 套候选方案，差异在「覆盖多少客户／投入多少人力／话术多贴合个人」三项上`, status: 'completed' },
    { seq: 6, actor: '群体推演', action: '推演客户反应', result: `分 ${steps} 段推演，跌幅 ${(scenario.marketShock * 100).toFixed(0)}%、每段 ${stepHours(scenario).toFixed(1)} 小时、随机种子 ${seed}`, status: 'completed' },
    { seq: 7, actor: '合规审查', action: '合规检查', result: `${blockedDrafts} 套方案的违规话术已在推演前拦下并改写、${blockedFindings.length} 项违规、${reviewFindings.length} 项待人工确认，规则版本 ${RULE_VERSION}`, status: blockedFindings.length ? 'blocked' : reviewFindings.length ? 'pending' : 'completed' },
    { seq: 8, actor: '结果复盘', action: '汇总结论并留存技能', result: `建议「${strategies[0].name}」：综合推荐度 ${relativeUtility(recommendedUtility).total.toFixed(2)}（以「不主动沟通」为 0 分基准）= 风险改善 ${relativeUtility(recommendedUtility).avoidance.toFixed(2)} − 人力成本 ${Math.abs(relativeUtility(recommendedUtility).cost).toFixed(2)} − 打扰代价 ${Math.abs(relativeUtility(recommendedUtility).wake).toFixed(2)}；比次优方案「${strategies[1]?.name ?? '无'}」高 ${(relativeUtility(recommendedUtility).total - relativeUtility(strategies[1]?.utility ?? recommendedUtility).total).toFixed(2)} 分`, status: 'completed' },
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
    utilityWeights: weights,
    strategySearch,
    explanationFactors: [
      {
        label: '行情跌幅',
        weight: clamp(Math.abs(scenario.marketShock) / 0.35),
        evidence: `市场跌幅 ${(Math.abs(scenario.marketShock) * 100).toFixed(0)}% 按持仓弹性逐客户换算为回撤，平均 ${averageDrawdown.toFixed(1)}%。`,
        direction: '风险上升',
      },
      {
        label: '客户怕亏程度',
        weight: baseCustomers.reduce((sum, customer) => sum + customer.psychology.lossAversion, 0) / customerCount,
        evidence: '来自五类客户画像的心理特征均值，按客户逐一计算。',
        direction: '风险上升',
      },
      {
        label: '客户之间互相影响',
        weight: baseCustomers.reduce((sum, customer) => sum + customer.psychology.herding, 0) / customerCount,
        evidence: `${relationships.length} 条相似性、社交影响和统一服务关系边参与邻居状态更新。`,
        direction: '风险上升',
      },
      {
        label: '行情持续时间',
        weight: clamp(Math.log(Math.max(scenario.durationHours, 1) / 24) / Math.log(7), 0, 1),
        evidence: `行情持续 ${scenario.durationHours} 小时、每段 ${stepHours(scenario).toFixed(1)} 小时；持续越久压力衰减越慢、峰值越高。需要说明的是：现有参数下峰值仍出现在第一段。`,
        direction: '风险上升',
      },
      {
        label: '推荐方案的作用',
        weight: clamp(recommendedStrategy.personalize),
        evidence: `推荐方案覆盖 ${(recommendedStrategy.reach * 100).toFixed(0)}% 的客户、人工投入 ${(recommendedStrategy.depth * 100).toFixed(0)}%、话术个性化 ${(recommendedStrategy.personalize * 100).toFixed(0)}%；覆盖哪些客户是逐一判定的，个性化程度决定通用话术对高风险和低风险客户是否贴合。`,
        direction: '风险缓释',
      },
      {
        label: '人力成本与打扰代价',
        weight: clamp(recommendedUtility.cost * 4 + recommendedUtility.wake * 12),
        evidence: `推荐方案的人力成本 ${recommendedUtility.cost.toFixed(3)}、打扰代价 ${recommendedUtility.wake.toFixed(3)}；联系得越广越快，越容易惊动本来不怎么关注账户的客户。`,
        direction: '风险上升',
      },
      {
        label: '合规检查',
        weight: clamp((blockedDrafts * 2 + blockedFindings.length * 2 + reviewFindings.length) / 8),
        evidence: `${blockedDrafts} 套方案里的违规表达已在推演前拦下并改写，不再计入推演结果；共 ${blockedFindings.length} 项违规、${reviewFindings.length} 项待人工确认，规则版本 ${RULE_VERSION}。`,
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
    strategy.utility.avoidance.toFixed(6),
    strategy.utility.cost.toFixed(6),
    strategy.utility.wake.toFixed(6),
    strategy.peakPanic.toFixed(6),
    strategy.finalSell.toFixed(6),
    strategy.finalComplaint.toFixed(6),
    strategy.finalChurn.toFixed(6),
    strategy.snapshots.map((snapshot) => `${snapshot.step}:${snapshot.panic.toFixed(6)}:${snapshot.coverage.toFixed(6)}`).join(','),
  ].join('|'));
  return `${result.scenario.targetSegment}|${result.seed}|${result.customerCount}|${result.relationships.length}|${strategies.join('||')}`;
}

export function percent(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * 用给定的杠杆组合跑一次单策略模拟。
 * 供参数空间搜索与「只改覆盖率会改结果」的敏感性回归使用。
 */
export function simulateWithLevers(
  scenario: ScenarioConfig,
  levers: StrategyLevers,
  seedOffset = 977,
): StrategyMetrics {
  const params = deriveStrategyParams(levers);
  const pool = buildCustomerPool(scenario);
  const relationships = generateRelationships(pool.customers, scenario.seed);
  const run = runStrategy(
    pool.customers,
    relationships,
    {
      ...params,
      id: 'segmented',
      name: '参数点',
      description: '',
      draftText: '',
      compliantDraftText: '',
    },
    scenario,
    scenario.seed + seedOffset,
    allAblationsOff,
    params.toneRisk,
  );
  return run.metrics;
}
