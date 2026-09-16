import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  coerceScenarioConfig,
  defaultScenario,
  parseScenarioPrompt,
  scenarioBounds,
} from './scenario';

describe('parseScenarioPrompt', () => {
  it('从自然语言抽取全部场景参数', () => {
    const parsed = parseScenarioPrompt(
      '市场今天下跌 30%，请分析持有高波动产品的 500 名客户，模拟未来 72 小时的群体反应，使用 20 个时间步，随机种子 1234。',
    );
    expect(parsed.config.marketShock).toBeCloseTo(-0.3, 6);
    expect(parsed.config.durationHours).toBe(72);
    expect(parsed.config.customerCount).toBe(500);
    expect(parsed.config.timeSteps).toBe(20);
    expect(parsed.config.seed).toBe(1234);
    expect(parsed.config.targetSegment).toBe('high_volatility_drawdown');
    expect(parsed.defaultedFields).toEqual([]);
  });

  it('支持天为单位的持续时间与全部客户客群', () => {
    const parsed = parseScenarioPrompt('假设市场下跌 15%，持续 3 天，针对全部客户做压力测试。');
    expect(parsed.config.durationHours).toBe(72);
    expect(parsed.config.marketShock).toBeCloseTo(-0.15, 6);
    expect(parsed.config.targetSegment).toBe('all_customers');
  });

  it('缺失字段回落到默认值并被显式记录', () => {
    const parsed = parseScenarioPrompt('帮我看看客户最近的情绪。');
    expect(parsed.config).toEqual(defaultScenario);
    expect(parsed.defaultedFields).toContain('marketShock');
    expect(parsed.defaultedFields).toContain('durationHours');
    expect(parsed.defaultedFields).toContain('customerCount');
    expect(parsed.defaultedFields).toContain('timeSteps');
    expect(parsed.defaultedFields).toContain('seed');
  });

  it('超出边界时收敛到边界值并给出说明', () => {
    const parsed = parseScenarioPrompt('市场暴跌 90%，5000 名客户，时间步 50 个，持续 900 小时。');
    expect(parsed.config.marketShock).toBe(-scenarioBounds.marketShock.max);
    expect(parsed.config.customerCount).toBe(scenarioBounds.customerCount.max);
    expect(parsed.config.timeSteps).toBe(scenarioBounds.timeSteps.max);
    expect(parsed.config.durationHours).toBe(scenarioBounds.durationHours.max);
    expect(parsed.notes.length).toBeGreaterThan(0);
  });

  it('低于下限时收敛到各自的下边界', () => {
    const parsed = coerceScenarioConfig({
      marketShock: 0.001,
      durationHours: 0.2,
      customerCount: 10,
      timeSteps: 3,
      seed: 1,
      targetSegment: 'all_customers',
    });
    expect(parsed.config.marketShock).toBe(-scenarioBounds.marketShock.min);
    expect(parsed.config.durationHours).toBe(scenarioBounds.durationHours.min);
    expect(parsed.config.customerCount).toBe(scenarioBounds.customerCount.min);
    expect(parsed.config.timeSteps).toBe(scenarioBounds.timeSteps.min);
  });

  it('小于 1 的跌幅按比例口径解释（0.1 等同于 10%）', () => {
    const parsed = parseScenarioPrompt('市场下跌 0.1%，500 名客户，时间步 10 个，持续 24 小时。');
    expect(parsed.config.marketShock).toBe(-0.1);
  });

  it('标准任务集中的 20 条业务任务都能解析出预期场景', () => {
    const cases = readFileSync('evals/tasks.jsonl', 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id: string; prompt: string; expect: Record<string, unknown> });
    expect(cases.length).toBe(20);
    for (const item of cases) {
      const parsed = parseScenarioPrompt(item.prompt);
      for (const [key, value] of Object.entries(item.expect)) {
        expect([item.id, key, (parsed.config as unknown as Record<string, unknown>)[key]]).toEqual([item.id, key, value]);
      }
    }
  });
  it('容忍“客户 5000 名 / 时间步 50 个”这类语序', () => {
    const parsed = parseScenarioPrompt('按客户 800 名、时间步 12 个重新跑一次。');
    expect(parsed.config.customerCount).toBe(800);
    expect(parsed.config.timeSteps).toBe(12);
  });

  it('跌幅以负数进入配置，且下限不低于 1%', () => {
    expect(parseScenarioPrompt('下跌 0.001%').config.marketShock).toBe(-0.01);
    expect(parseScenarioPrompt('下跌 10%').config.marketShock).toBeLessThan(0);
  });
});

describe('coerceScenarioConfig', () => {
  it('拒绝非法客群取值并回落到默认客群', () => {
    const parsed = coerceScenarioConfig({ targetSegment: 'unknown-segment', customerCount: 200 });
    expect(parsed.config.targetSegment).toBe(defaultScenario.targetSegment);
    expect(parsed.defaultedFields).toContain('targetSegment');
    expect(parsed.config.customerCount).toBe(200);
  });

  it('接受字符串数字，兼容模型输出的宽松格式', () => {
    const parsed = coerceScenarioConfig({ marketShock: '-0.2', durationHours: '48', customerCount: '300' });
    expect(parsed.config.marketShock).toBeCloseTo(-0.2, 6);
    expect(parsed.config.durationHours).toBe(48);
    expect(parsed.defaultedFields).not.toContain('customerCount');
  });
});
