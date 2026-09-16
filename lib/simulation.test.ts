import { describe, expect, it } from 'vitest';
import { defaultScenario, type ScenarioConfig } from './scenario';
import {
  aggregateSignature,
  buildCustomerPool,
  generateCustomers,
  matchesSegment,
  runSimulation,
  shockShape,
  type StrategyId,
} from './simulation';

const base: ScenarioConfig = { ...defaultScenario, customerCount: 120, timeSteps: 8 };

function strategy(result: ReturnType<typeof runSimulation>, id: StrategyId) {
  const found = result.strategies.find((item) => item.id === id);
  if (!found) throw new Error(`missing strategy ${id}`);
  return found;
}

describe('确定性', () => {
  it('相同场景与随机种子产生完全一致的聚合结果', () => {
    const first = runSimulation(base);
    const second = runSimulation({ ...base });
    expect(aggregateSignature(first)).toBe(aggregateSignature(second));
  });

  it('相同种子重复生成客户与关系网络完全一致', () => {
    const a = generateCustomers(200, 4242, 0.1);
    const b = generateCustomers(200, 4242, 0.1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('不同种子产生不同客户结构', () => {
    const a = generateCustomers(200, 1, 0.1);
    const b = generateCustomers(200, 2, 0.1);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe('市场冲击真实生效', () => {
  const shocks = [0.1, 0.2, 0.3];

  it('客户回撤随跌幅单调上升', () => {
    const drawdowns = shocks.map((shock) => {
      const pool = buildCustomerPool({ ...base, marketShock: -shock });
      return pool.customers.reduce((sum, customer) => sum + customer.drawdown, 0) / pool.customers.length;
    });
    expect(drawdowns[1]).toBeGreaterThan(drawdowns[0]);
    expect(drawdowns[2]).toBeGreaterThan(drawdowns[1]);
  });

  it('恐慌、卖出与流失风险不随跌幅上升而反向下降', () => {
    const results = shocks.map((shock) => runSimulation({ ...base, marketShock: -shock }));
    (['baseline', 'broadcast', 'segmented'] as StrategyId[]).forEach((id) => {
      const series = results.map((result) => strategy(result, id));
      expect(series[1].peakPanic).toBeGreaterThanOrEqual(series[0].peakPanic - 1e-6);
      expect(series[2].peakPanic).toBeGreaterThanOrEqual(series[1].peakPanic - 1e-6);
      expect(series[1].finalSell).toBeGreaterThanOrEqual(series[0].finalSell - 1e-6);
      expect(series[2].finalSell).toBeGreaterThanOrEqual(series[1].finalSell - 1e-6);
      expect(series[2].finalChurn).toBeGreaterThanOrEqual(series[0].finalChurn - 1e-6);
    });
  });
});

describe('持续时间真实生效', () => {
  it('压力形态随持续时间单调上升', () => {
    [0, 0.25, 0.5, 0.75, 1].forEach((progress) => {
      const shapes = [24, 48, 72, 168].map((hours) => shockShape(hours, progress));
      for (let index = 1; index < shapes.length; index += 1) {
        expect(shapes[index]).toBeGreaterThan(shapes[index - 1]);
      }
    });
  });

  it('持续时间越长群体恐慌与流失越高，峰值越靠后', () => {
    const results = [24, 72].map((durationHours) => runSimulation({ ...base, durationHours }));
    const short = results[0];
    const long = results[1];
    // 用固定策略（不主动沟通）比对，隔离“推荐策略变化”对期末恐慌的干扰。
    const finalPanic = (result: ReturnType<typeof runSimulation>) => strategy(result, 'baseline').snapshots.at(-1)!.panic;
    expect(finalPanic(long)).toBeGreaterThan(finalPanic(short));
    const peakStep = (result: ReturnType<typeof runSimulation>) => {
      const snapshots = strategy(result, 'baseline').snapshots;
      return snapshots.reduce((best, snapshot) => (snapshot.panic > best.panic ? snapshot : best), snapshots[0]).step;
    };
    expect(peakStep(long)).toBeGreaterThanOrEqual(peakStep(short));
    expect(strategy(long, 'segmented').finalChurn).toBeGreaterThanOrEqual(strategy(short, 'segmented').finalChurn - 1e-6);
  });
});

describe('目标客群筛选', () => {
  it('高波动回撤客群只包含高波动产品且回撤达标', () => {
    const pool = buildCustomerPool({ ...base, marketShock: -0.1 });
    expect(pool.customers.length).toBe(base.customerCount);
    pool.customers.forEach((customer) => expect(matchesSegment(customer, 'high_volatility_drawdown')).toBe(true));
  });

  it('全部客户客群不做筛选', () => {
    const pool = buildCustomerPool({ ...base, targetSegment: 'all_customers' });
    expect(pool.customers.length).toBe(base.customerCount);
    expect(pool.excludedCustomers).toBe(0);
    expect(pool.segmentRelaxed).toBe(false);
  });

  it('目标客群结构跨市场情景保持稳定，便于横向对比', () => {
    const shallow = buildCustomerPool({ ...base, marketShock: -0.03, customerCount: 300 });
    const deep = buildCustomerPool({ ...base, marketShock: -0.3, customerCount: 300 });
    expect(shallow.customers.map((customer) => customer.id)).toEqual(deep.customers.map((customer) => customer.id));
    expect(shallow.segmentRelaxed).toBe(false);
    expect(shallow.matchedCustomers).toBeGreaterThanOrEqual(300);
  });
});

describe('行为输出约束', () => {
  it('每个客户买入、持有、卖出之和为 1', () => {
    const result = runSimulation(base);
    result.strategies.forEach((item) => {
      item.snapshots.forEach((snapshot) => {
        expect(snapshot.buy + snapshot.hold + snapshot.sell).toBeCloseTo(1, 6);
      });
    });
  });

  it('时间步快照数量与场景一致且携带真实小时数', () => {
    const result = runSimulation({ ...base, durationHours: 48, timeSteps: 12 });
    const snapshots = strategy(result, 'segmented').snapshots;
    expect(snapshots).toHaveLength(12);
    expect(snapshots[0].stepHours).toBeCloseTo(4, 6);
    expect(snapshots[11].stepHours).toBeCloseTo(48, 6);
  });
});

describe('消融开关', () => {
  it('关闭传播层后传播指标归零', () => {
    const result = runSimulation(base, { ablations: { disableContagion: true } });
    result.strategies.forEach((item) => {
      item.snapshots.forEach((snapshot) => expect(snapshot.contagion).toBe(0));
    });
  });

  it('关闭心理层后所有客户心理参数被抹平', () => {
    const result = runSimulation(base, { ablations: { disablePsychology: true } });
    result.customers.forEach((customer) => {
      expect(customer.psychology.lossAversion).toBe(0.5);
      expect(customer.psychology.herding).toBe(0.5);
    });
  });

  it('关闭合规层后不产生合规发现', () => {
    const result = runSimulation(base, { ablations: { disableCompliance: true } });
    expect(result.findings).toEqual([]);
    result.strategies.forEach((item) => expect(item.findings).toEqual([]));
  });

  it('关闭记忆层改变结果但不破坏确定性', () => {
    const withMemory = runSimulation(base);
    const withoutMemory = runSimulation(base, { ablations: { disableMemory: true } });
    expect(aggregateSignature(withMemory)).not.toBe(aggregateSignature(withoutMemory));
    expect(aggregateSignature(withoutMemory)).toBe(
      aggregateSignature(runSimulation(base, { ablations: { disableMemory: true } })),
    );
  });
});

describe('合规与审计输出', () => {
  it('策略草稿中的高风险表达被 Policy Gateway 拦截并改写', () => {
    const result = runSimulation(base);
    const broadcast = strategy(result, 'broadcast');
    expect(broadcast.draftText).toContain('务必立即行动');
    expect(broadcast.effectiveDraftText).not.toContain('务必立即行动');
    expect(broadcast.findings.some((finding) => finding.status === '已拦截')).toBe(true);
    expect(broadcast.complianceRisk).toBe('高');
  });

  it('一人一策中的合规表达不会被误拦', async () => {
    const { buildMicroCommunicationPlan } = await import('./simulation');
    const { checkText } = await import('./compliance');
    const result = runSimulation(base);
    const recommended = strategy(result, result.recommended);
    const states = recommended.customerStates[recommended.customerStates.length - 1];
    const customer = result.customers[0];
    const state = states.find((item) => item.id === customer.id) ?? states[0];
    const micro = buildMicroCommunicationPlan(customer, state, result.scenario);
    const verdict = checkText(micro.recommendedMessage, { scope: 'message' });
    expect(verdict.passed).toBe(true);
    expect(verdict.findings.filter((finding) => finding.severity === '阻断')).toEqual([]);
  });

  it('审计轨迹带序号与真实参数，不含硬编码时间', () => {
    const result = runSimulation({ ...base, marketShock: -0.27, durationHours: 48 });
    expect(result.audit.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    result.audit.forEach((entry) => expect(entry.at).toBeUndefined());
    expect(result.audit[0].result).toContain('-27%');
    expect(result.audit[0].result).toContain('48 小时');
    expect(result.audit[5].result).toContain('每步 6.0 小时');
  });
});

describe('客户队列优先级', () => {
  it('优先级取自模拟期峰值暴露，而非回落后的期末状态', () => {
    const result = runSimulation({ ...base, marketShock: -0.3 });
    result.customers.forEach((customer) => {
      expect(customer.peakRisk).toBeGreaterThanOrEqual(0);
      expect(customer.peakPanic).toBeGreaterThanOrEqual(customer.panic - 1e-9);
    });
    const peaked = result.customers.filter((customer) => customer.peakRisk > customer.panic).length;
    expect(peaked).toBe(result.customers.length);
  });

  it('冲击越大需要优先介入的客户越多', () => {
    const counts = [0.1, 0.2, 0.3].map((shock) => {
      const result = runSimulation({ ...base, marketShock: -shock });
      return result.customers.filter((customer) => customer.priority !== '低').length;
    });
    expect(counts[1]).toBeGreaterThanOrEqual(counts[0]);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[2]).toBeGreaterThan(0);
    const highAtSevere = runSimulation({ ...base, marketShock: -0.3 }).customers.filter((customer) => customer.priority === '高').length;
    expect(highAtSevere).toBeGreaterThan(0);
  });

  it('队列排序把峰值风险最高的客户排在最前', () => {
    const result = runSimulation({ ...base, marketShock: -0.3 });
    const rank = { 高: 3, 中: 2, 低: 1 } as const;
    const priorities = result.customers.map((customer) => rank[customer.priority]);
    for (let index = 1; index < priorities.length; index += 1) {
      expect(priorities[index]).toBeLessThanOrEqual(priorities[index - 1]);
    }
  });
});
