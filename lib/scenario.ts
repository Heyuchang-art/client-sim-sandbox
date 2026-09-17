export type TargetSegment = 'high_volatility_drawdown' | 'all_customers';

export type ScenarioConfig = {
  marketShock: number;
  durationHours: number;
  customerCount: number;
  timeSteps: number;
  seed: number;
  targetSegment: TargetSegment;
};

export type ScenarioField = keyof ScenarioConfig;

export type ParsedScenario = {
  config: ScenarioConfig;
  defaultedFields: ScenarioField[];
  notes: string[];
};

export const scenarioBounds = {
  marketShock: { min: 0.01, max: 0.5 },
  durationHours: { min: 1, max: 168 },
  customerCount: { min: 50, max: 1000 },
  timeSteps: { min: 5, max: 20 },
  seed: { min: 1, max: 2147483647 },
} as const;

export const defaultScenario: ScenarioConfig = {
  marketShock: -0.1,
  durationHours: 24,
  customerCount: 300,
  timeSteps: 10,
  seed: 20260830,
  targetSegment: 'high_volatility_drawdown',
};

/**
 * 目标客群筛选阈值：在基准冲击下持仓回撤主项达到该百分比才进入高波动回撤客群。
 * 实际筛选按持仓弹性 beta 判定（beta >= 0.8 等价于基准冲击下回撤主项 >= 8%），
 * 不含客户个体的 ±1.5 个百分点扰动，因此入选客户的期末回撤可能略低于 8%。
 */
export const segmentDrawdownThreshold = 8;
/** 客群口径固定在基准冲击下评估，保证不同市场情景下目标客群结构一致、可跨情景对比。 */
export const segmentReferenceShockPercent = 10;
export const segmentBetaThreshold = segmentDrawdownThreshold / segmentReferenceShockPercent;

export const segmentLabels: Record<TargetSegment, string> = {
  high_volatility_drawdown: '高波动回撤客户',
  all_customers: '全部客户',
};

export const scenarioFieldLabels: Record<ScenarioField, string> = {
  marketShock: '市场跌幅',
  durationHours: '持续时间',
  customerCount: '客户数量',
  timeSteps: '时间步',
  seed: '随机种子',
  targetSegment: '目标客群',
};

export function segmentCriteria(segment: TargetSegment) {
  return segment === 'high_volatility_drawdown'
    ? `持有高波动产品、在 ${segmentReferenceShockPercent}% 基准冲击下回撤不低于 ${segmentDrawdownThreshold}% 的客户（客群口径跨情景稳定）`
    : '全部在库客户';
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function asFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function normalizeScenarioConfig(config: ScenarioConfig): ScenarioConfig {
  return {
    marketShock: -clampNumber(Math.abs(config.marketShock), scenarioBounds.marketShock.min, scenarioBounds.marketShock.max),
    durationHours: Math.round(clampNumber(config.durationHours, scenarioBounds.durationHours.min, scenarioBounds.durationHours.max)),
    customerCount: Math.round(clampNumber(config.customerCount, scenarioBounds.customerCount.min, scenarioBounds.customerCount.max)),
    timeSteps: Math.round(clampNumber(config.timeSteps, scenarioBounds.timeSteps.min, scenarioBounds.timeSteps.max)),
    seed: Math.round(clampNumber(config.seed, scenarioBounds.seed.min, scenarioBounds.seed.max)),
    targetSegment: config.targetSegment === 'all_customers' ? 'all_customers' : 'high_volatility_drawdown',
  };
}

/**
 * 把任意来源（正则抽取结果或模型输出）强制收敛为合法且可追踪的 ScenarioConfig。
 * 缺失或非法的字段回落到 base 值，并记录在 defaultedFields，界面必须显式提示。
 */
export function coerceScenarioConfig(
  raw: Partial<Record<ScenarioField, unknown>>,
  base: ScenarioConfig = defaultScenario,
): ParsedScenario {
  const defaultedFields: ScenarioField[] = [];
  const notes: string[] = [];
  const pick = (field: ScenarioField) => {
    const value = asFiniteNumber(raw[field]);
    if (value === null) defaultedFields.push(field);
    return value;
  };

  const shockInput = pick('marketShock');
  const durationInput = pick('durationHours');
  const customerInput = pick('customerCount');
  const stepsInput = pick('timeSteps');
  const seedInput = pick('seed');

  const segmentValue = raw.targetSegment;
  let targetSegment: TargetSegment = base.targetSegment;
  if (segmentValue === 'all_customers' || segmentValue === 'high_volatility_drawdown') {
    targetSegment = segmentValue;
  } else if (segmentValue === undefined) {
    defaultedFields.push('targetSegment');
  } else {
    defaultedFields.push('targetSegment');
    notes.push('目标客群取值非法，已回落到默认客群。');
  }

  // 兼容两种输入口径：0.2 与 20 都表示下跌 20%，配置内部统一使用小数。
  const rawShock = shockInput === null ? Math.abs(base.marketShock) : Math.abs(shockInput);
  const shockMagnitude = rawShock > 1 ? rawShock / 100 : rawShock;
  if (shockInput !== null && (shockMagnitude < scenarioBounds.marketShock.min || shockMagnitude > scenarioBounds.marketShock.max)) {
    notes.push(`市场跌幅超出 ${scenarioBounds.marketShock.min * 100}%—${scenarioBounds.marketShock.max * 100}% 区间，已收敛到边界值。`);
  }
  const durationValue = durationInput === null ? base.durationHours : durationInput;
  if (durationInput !== null && (durationValue < scenarioBounds.durationHours.min || durationValue > scenarioBounds.durationHours.max)) {
    notes.push(`持续时间超出 ${scenarioBounds.durationHours.min}—${scenarioBounds.durationHours.max} 小时区间，已收敛到边界值。`);
  }
  const customerValue = customerInput === null ? base.customerCount : customerInput;
  if (customerInput !== null && (customerValue < scenarioBounds.customerCount.min || customerValue > scenarioBounds.customerCount.max)) {
    notes.push(`客户数量超出 ${scenarioBounds.customerCount.min}—${scenarioBounds.customerCount.max} 区间，已收敛到边界值。`);
  }
  const stepsValue = stepsInput === null ? base.timeSteps : stepsInput;
  if (stepsInput !== null && (stepsValue < scenarioBounds.timeSteps.min || stepsValue > scenarioBounds.timeSteps.max)) {
    notes.push(`时间步超出 ${scenarioBounds.timeSteps.min}—${scenarioBounds.timeSteps.max} 区间，已收敛到边界值。`);
  }

  const config = normalizeScenarioConfig({
    marketShock: -shockMagnitude,
    durationHours: durationValue,
    customerCount: customerValue,
    timeSteps: stepsValue,
    seed: seedInput === null ? base.seed : seedInput,
    targetSegment,
  });

  return { config, defaultedFields: [...new Set(defaultedFields)], notes };
}

function parseSegment(prompt: string): TargetSegment | undefined {
  if (/全部客户|所有客户|全量客户|不限客群|不筛选/.test(prompt)) return 'all_customers';
  if (/高波动|高回撤|回撤客户|回撤超过|回撤不低于|回撤达/.test(prompt)) return 'high_volatility_drawdown';
  return undefined;
}

/**
 * 规则抽取：模型不可用时的确定性兜底路径，与模型路径共用同一套边界收敛逻辑。
 */
export function parseScenarioPrompt(prompt: string): ParsedScenario {
  const shockMatch = prompt.match(/(?:下跌|跌幅|跌了|暴跌|回撤)(?:幅度)?\s*(?:约|达到|为|改成|改成到|设为|至)?\s*(-?\d+(?:\.\d+)?)\s*%/i)
    ?? prompt.match(/(-?\d+(?:\.\d+)?)\s*%\s*(?:的)?(?:下跌|跌幅|暴跌|回撤)/i);
  const hoursMatch = prompt.match(/(?:未来|持续|维持)?\s*(\d+(?:\.\d+)?)\s*(小时|天)/);
  const customersMatch = prompt.match(/(\d+)\s*名(?:合成|虚拟|目标)?客户/) ?? prompt.match(/(?:客户|客群|人数)\s*(?:数|数量)?\s*(?:为|是|设为|共|约)?\s*(\d+)\s*名/);
  const stepsMatch = prompt.match(/(\d+)\s*(?:个)?时间步/) ?? prompt.match(/时间步\s*(?:为|是|设为|改成)?\s*(\d+)/);
  const seedMatch = prompt.match(/随机种子\s*(\d+)/);

  const raw: Partial<Record<ScenarioField, unknown>> = {};
  if (shockMatch) raw.marketShock = Number(shockMatch[1]);
  if (hoursMatch) raw.durationHours = Number(hoursMatch[1]) * (hoursMatch[2] === '天' ? 24 : 1);
  if (customersMatch) raw.customerCount = Number(customersMatch[1]);
  if (stepsMatch) raw.timeSteps = Number(stepsMatch[1]);
  if (seedMatch) raw.seed = Number(seedMatch[1]);
  const segment = parseSegment(prompt);
  if (segment) raw.targetSegment = segment;

  return coerceScenarioConfig(raw);
}

export function scenarioLabel(config: ScenarioConfig) {
  return `市场下跌 ${(Math.abs(config.marketShock) * 100).toFixed(0)}% · ${config.durationHours} 小时 · ${segmentLabels[config.targetSegment]}`;
}

export function stepHours(config: ScenarioConfig) {
  return config.durationHours / config.timeSteps;
}

export function scenarioTrace(config: ScenarioConfig) {
  return {
    marketShock: config.marketShock,
    durationHours: config.durationHours,
    customerCount: config.customerCount,
    timeSteps: config.timeSteps,
    seed: config.seed,
    targetSegment: config.targetSegment,
    stepHours: Number(stepHours(config).toFixed(3)),
  };
}
