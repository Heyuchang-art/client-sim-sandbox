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
  drawdown: number;
  influence: number;
  psychology: Psychology;
  panic: number;
  sell: number;
  complaint: number;
  churn: number;
  priority: '高' | '中' | '低';
};

export type Snapshot = {
  step: number;
  panic: number;
  sell: number;
  complaint: number;
  churn: number;
  trust: number;
  coverage: number;
};

export type StrategyResult = {
  id: StrategyId;
  name: string;
  description: string;
  score: number;
  snapshots: Snapshot[];
  peakPanic: number;
  finalSell: number;
  finalComplaint: number;
  finalChurn: number;
  finalTrust: number;
  complianceRisk: '低' | '中' | '高';
};

export type SimulationResult = {
  seed: number;
  durationMs: number;
  customerCount: number;
  customers: Customer[];
  strategies: StrategyResult[];
  recommended: StrategyId;
  findings: Array<{
    id: string;
    severity: '阻断' | '警告' | '提示';
    rule: string;
    strategy: string;
    detail: string;
    status: '已拦截' | '待审批' | '通过';
  }>;
  audit: Array<{
    time: string;
    actor: string;
    action: string;
    result: string;
  }>;
};

export const strategyDefinitions: Array<{
  id: StrategyId;
  name: string;
  description: string;
  calming: number;
  trustLift: number;
  coverage: number;
  toneRisk: number;
}> = [
  {
    id: 'baseline',
    name: '不主动沟通',
    description: '保持现状，仅响应客户主动咨询。',
    calming: 0,
    trustLift: -0.035,
    coverage: 0.08,
    toneRisk: 0,
  },
  {
    id: 'broadcast',
    name: '统一风险提示',
    description: '向全部目标客户发送统一的市场风险通知。',
    calming: 0.07,
    trustLift: 0.02,
    coverage: 0.95,
    toneRisk: 0.055,
  },
  {
    id: 'segmented',
    name: '分群差异化沟通',
    description: '按风险偏好与心理特征生成差异化内容，优先干预关键节点。',
    calming: 0.19,
    trustLift: 0.095,
    coverage: 0.86,
    toneRisk: 0,
  },
];

const archetypes = [
  { name: '稳健守成型', weight: 0.27, risk: 'C2' as const },
  { name: '长期成长型', weight: 0.25, risk: 'C3' as const },
  { name: '进取交易型', weight: 0.17, risk: 'C4' as const },
  { name: '高频敏感型', weight: 0.14, risk: 'C5' as const },
  { name: '沉默流失型', weight: 0.17, risk: 'C2' as const },
];

const products = ['科技成长组合', '量化增强产品', '新能源主题基金', '红利低波组合'];
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

export function generateCustomers(count = 300, seed = 20260830): Customer[] {
  const random = mulberry32(seed);
  return Array.from({ length: count }, (_, index) => {
    const archetype = pickArchetype(random);
    const psychology = psychologyFor(archetype.name, random);
    const drawdown = 6 + random() * 16;
    const panic = clamp(
      0.1 + psychology.lossAversion * 0.35 + psychology.herding * 0.12 + drawdown / 100 - psychology.discipline * 0.18,
    );
    const influence = clamp(random() * 0.68 + psychology.herding * 0.25);
    return {
      id: `C-${String(1001 + index).padStart(4, '0')}`,
      name: `${surnames[index % surnames.length]}**`,
      archetype: archetype.name,
      riskLevel: archetype.risk,
      product: products[index % products.length],
      drawdown: Number(drawdown.toFixed(1)),
      influence,
      psychology,
      panic,
      sell: clamp(logistic((panic - 0.55) * 5 - psychology.discipline)),
      complaint: 0,
      churn: 0,
      priority: '低',
    };
  });
}

function runStrategy(
  baseCustomers: Customer[],
  strategy: (typeof strategyDefinitions)[number],
  steps: number,
  seed: number,
): { result: StrategyResult; customers: Customer[] } {
  const random = mulberry32(seed + strategy.id.length * 997);
  const customers = baseCustomers.map((customer) => ({
    ...customer,
    psychology: { ...customer.psychology },
  }));
  const snapshots: Snapshot[] = [];
  let previousMeanPanic = customers.reduce((sum, customer) => sum + customer.panic, 0) / customers.length;

  for (let step = 1; step <= steps; step += 1) {
    const marketStress = 0.21 + step * 0.012;
    for (const customer of customers) {
      const p = customer.psychology;
      const targetedBoost = strategy.id === 'segmented'
        ? strategy.calming * (0.65 + p.trust * 0.45 + customer.influence * 0.15)
        : strategy.calming;
      const broadcastAlarm = strategy.id === 'broadcast'
        ? strategy.toneRisk * (p.lossAversion + p.herding)
        : 0;
      const neighborEffect = previousMeanPanic * p.herding * 0.2;
      const noise = (random() - 0.5) * 0.035;
      customer.panic = clamp(
        customer.panic * 0.56 +
          marketStress * p.lossAversion +
          neighborEffect +
          broadcastAlarm -
          targetedBoost -
          p.discipline * 0.09 -
          p.patience * 0.045 +
          noise,
      );
      p.trust = clamp(p.trust + strategy.trustLift * (0.45 + step / steps) - customer.panic * 0.012);
      customer.sell = clamp(logistic((customer.panic - 0.58) * 5.2 + p.herding * 0.7 - p.discipline * 1.1));
      customer.complaint = clamp(logistic((customer.panic - 0.62) * 4.2 - p.trust * 2.3 + strategy.toneRisk * 7) * 0.42);
      customer.churn = clamp(logistic((0.45 - p.trust) * 5 + customer.complaint * 2.2) * 0.38);
      const riskScore = customer.panic * 0.35 + customer.sell * 0.3 + customer.complaint * 0.2 + customer.influence * 0.15;
      customer.priority = riskScore > 0.58 ? '高' : riskScore > 0.39 ? '中' : '低';
    }

    previousMeanPanic = customers.reduce((sum, customer) => sum + customer.panic, 0) / customers.length;
    const mean = (selector: (customer: Customer) => number) =>
      customers.reduce((sum, customer) => sum + selector(customer), 0) / customers.length;
    snapshots.push({
      step,
      panic: mean((customer) => customer.panic),
      sell: mean((customer) => customer.sell),
      complaint: mean((customer) => customer.complaint),
      churn: mean((customer) => customer.churn),
      trust: mean((customer) => customer.psychology.trust),
      coverage: clamp(strategy.coverage * (0.55 + step / steps * 0.52)),
    });
  }

  const last = snapshots[snapshots.length - 1];
  const peakPanic = Math.max(...snapshots.map((snapshot) => snapshot.panic));
  const score = clamp(
    1 - peakPanic * 0.27 - last.sell * 0.25 - last.complaint * 0.2 - last.churn * 0.12 + last.trust * 0.16,
  );
  return {
    result: {
      id: strategy.id,
      name: strategy.name,
      description: strategy.description,
      score,
      snapshots,
      peakPanic,
      finalSell: last.sell,
      finalComplaint: last.complaint,
      finalChurn: last.churn,
      finalTrust: last.trust,
      complianceRisk: strategy.id === 'broadcast' ? '中' : strategy.id === 'baseline' ? '低' : '低',
    },
    customers,
  };
}

export function runSimulation(
  customerCount = 300,
  steps = 10,
  seed = 20260830,
): SimulationResult {
  const baseCustomers = generateCustomers(customerCount, seed);
  const runs = strategyDefinitions.map((strategy, index) =>
    runStrategy(baseCustomers, strategy, steps, seed + index * 101),
  );
  const strategies = runs.map((run) => run.result).sort((a, b) => b.score - a.score);
  const recommended = strategies[0].id;
  const recommendedCustomers = runs.find((run) => run.result.id === recommended)?.customers ?? baseCustomers;

  return {
    seed,
    // Keep the server-rendered and client-hydrated demo identical. Production
    // workers can attach observed wall-clock latency as a separate audit metric.
    durationMs: Math.round((8.6 + (customerCount * steps) / 1500) * 10) / 10,
    customerCount,
    customers: [...recommendedCustomers].sort((a, b) => {
      const priority = { 高: 3, 中: 2, 低: 1 };
      return priority[b.priority] - priority[a.priority] || b.influence - a.influence;
    }),
    strategies,
    recommended,
    findings: [
      {
        id: 'CF-001',
        severity: '阻断',
        rule: 'MISLEADING_URGENCY',
        strategy: '统一风险提示',
        detail: '“必须立即行动”可能构成诱导性表达，已从候选话术中移除。',
        status: '已拦截',
      },
      {
        id: 'CF-002',
        severity: '警告',
        rule: 'SUITABILITY_SCOPE',
        strategy: '分群差异化沟通',
        detail: '涉及 C1/C2 客户的高波动产品说明需由合规人员复核。',
        status: '待审批',
      },
      {
        id: 'CF-003',
        severity: '提示',
        rule: 'HUMAN_ANCHORING',
        strategy: '分群差异化沟通',
        detail: '高风险客户仅生成建议，实际触达前需客户经理确认。',
        status: '通过',
      },
    ],
    audit: [
      { time: '13:45:02', actor: 'Planner', action: '拆解业务目标', result: '生成 5 步执行计划' },
      { time: '13:45:04', actor: 'CustomerQueryTool', action: '筛选目标客户', result: `命中 ${customerCount} 名脱敏客户` },
      { time: '13:45:07', actor: 'ProfileTool', action: '构建行为画像', result: '5 类原型、6 个心理因素' },
      { time: '13:45:10', actor: 'StrategyTool', action: '生成候选策略', result: '3 套策略通过结构校验' },
      { time: '13:45:13', actor: 'SimulationTool', action: '执行群体模拟', result: `${steps} 个时间步、随机种子 ${seed}` },
      { time: '13:45:28', actor: 'PolicyGateway', action: '合规审查', result: '1 项阻断、1 项待审批' },
    ],
  };
}

export function percent(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}
