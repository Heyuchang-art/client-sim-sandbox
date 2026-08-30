export type ScenarioConfig = {
  marketShock: number;
  durationHours: number;
  customerCount: number;
  timeSteps: number;
  seed: number;
  targetSegment: 'high_volatility_drawdown';
};

export type ParsedScenario = {
  config: ScenarioConfig;
  defaultedFields: Array<keyof ScenarioConfig>;
};

export const defaultScenario: ScenarioConfig = {
  marketShock: -0.1,
  durationHours: 24,
  customerCount: 300,
  timeSteps: 10,
  seed: 20260830,
  targetSegment: 'high_volatility_drawdown',
};

function boundedInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function parseScenarioPrompt(prompt: string): ParsedScenario {
  const defaultedFields: Array<keyof ScenarioConfig> = [];
  const shockMatch = prompt.match(/(?:下跌|跌幅|跌了|暴跌|回撤)(?:幅度)?\s*(?:约|达到|为|改成|设为)?\s*(-?\d+(?:\.\d+)?)\s*%/i)
    ?? prompt.match(/(-?\d+(?:\.\d+)?)\s*%\s*(?:的)?(?:下跌|跌幅|暴跌|回撤)/i);
  const hoursMatch = prompt.match(/(?:未来|持续)?\s*(\d+(?:\.\d+)?)\s*(小时|天)/);
  const customersMatch = prompt.match(/(\d+)\s*名(?:合成|虚拟|目标)?客户/);
  const stepsMatch = prompt.match(/(\d+)\s*(?:个)?时间步/);
  const seedMatch = prompt.match(/随机种子\s*(\d+)/);

  if (!shockMatch) defaultedFields.push('marketShock');
  if (!hoursMatch) defaultedFields.push('durationHours');
  if (!customersMatch) defaultedFields.push('customerCount');
  if (!stepsMatch) defaultedFields.push('timeSteps');
  if (!seedMatch) defaultedFields.push('seed');

  const shockPercent = shockMatch ? Math.abs(Number(shockMatch[1])) : Math.abs(defaultScenario.marketShock * 100);
  const durationValue = hoursMatch ? Number(hoursMatch[1]) * (hoursMatch[2] === '天' ? 24 : 1) : defaultScenario.durationHours;

  return {
    config: {
      marketShock: -Math.min(0.5, Math.max(0.01, shockPercent / 100)),
      durationHours: boundedInteger(durationValue, 1, 168),
      customerCount: customersMatch ? boundedInteger(Number(customersMatch[1]), 50, 1000) : defaultScenario.customerCount,
      timeSteps: stepsMatch ? boundedInteger(Number(stepsMatch[1]), 5, 20) : defaultScenario.timeSteps,
      seed: seedMatch ? boundedInteger(Number(seedMatch[1]), 1, 2147483647) : defaultScenario.seed,
      targetSegment: 'high_volatility_drawdown',
    },
    defaultedFields,
  };
}

export function scenarioLabel(config: ScenarioConfig) {
  return `市场下跌 ${(Math.abs(config.marketShock) * 100).toFixed(0)}% · ${config.durationHours} 小时`;
}
