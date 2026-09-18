import { describe, expect, it } from 'vitest';
import { defaultScenario, type ScenarioConfig } from './scenario';
import {
  aggregateSignature,
  buildCustomerPool,
  defaultUtilityWeights,
  generateCustomers,
  matchesSegment,
  relativeUtilityBreakdown,
  runSimulation,
  shockShape,
  simulateWithLevers,
  strategyDefinitions,
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
    expect(result.audit[5].result).toContain('每段 6.0 小时');
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

describe('沟通策略参数空间', () => {
  const scenario: ScenarioConfig = { ...defaultScenario, marketShock: -0.3, durationHours: 48, customerCount: 300, timeSteps: 10 };

  it('三套策略在不同场景下都能成为最优解', () => {
    const winners = new Set<string>();
    for (const marketShock of [-0.05, -0.15, -0.3, -0.5]) {
      for (const durationHours of [6, 24, 72]) {
        winners.add(runSimulation({ ...scenario, marketShock, durationHours }).recommended);
      }
    }
    expect(winners.size).toBe(3);
  });

  it('推荐结果随跌幅方向变化：微跌不打扰，重挫转向深度干预', () => {
    expect(runSimulation({ ...scenario, marketShock: -0.05, durationHours: 24 }).recommended).toBe('baseline');
    expect(runSimulation({ ...scenario, marketShock: -0.5, durationHours: 72 }).recommended).toBe('segmented');
  });

  it('触达覆盖率由逐客户门控产生，不同策略不再共享同一份安抚', () => {
    const result = runSimulation(scenario);
    const coverageOf = (id: StrategyId) => result.strategies.find((item) => item.id === id)!.snapshots.at(-1)!.coverage;
    expect(coverageOf('broadcast')).toBeGreaterThan(coverageOf('baseline'));
    expect(coverageOf('segmented')).toBeGreaterThan(coverageOf('baseline'));
    // 分群沟通依赖人工爬坡，期末覆盖率低于统一推送。
    expect(coverageOf('segmented')).toBeLessThan(coverageOf('broadcast'));
  });

  it('策略参数由三个杠杆推导，不存在互相矛盾的独立常数', () => {
    const segmented = strategyDefinitions.find((item) => item.id === 'segmented')!;
    const broadcast = strategyDefinitions.find((item) => item.id === 'broadcast')!;
    expect(segmented.rampSteps).toBeGreaterThan(broadcast.rampSteps);
    expect(segmented.wake).toBeLessThan(broadcast.wake);
    expect(segmented.toneRisk).toBeLessThan(broadcast.toneRisk);
  });

  it('净效用等于避险收益减去成本与唤醒项', () => {
    for (const item of runSimulation(scenario).strategies) {
      const expected = item.utility.avoidance - defaultUtilityWeights.cost * item.utility.cost - defaultUtilityWeights.wake * item.utility.wake;
      expect(Math.abs(expected - item.utility.total)).toBeLessThan(1e-6);
    }
  });

  it('业务权重可覆盖：预算权重提高后推荐会从深度干预移开', () => {
    const lean = runSimulation({ ...scenario, marketShock: -0.5, durationHours: 72 }, { utilityWeights: { cost: 0.05 } }).recommended;
    const tight = runSimulation({ ...scenario, marketShock: -0.5, durationHours: 72 }, { utilityWeights: { cost: 0.5 } }).recommended;
    expect(lean).toBe('segmented');
    expect(tight).not.toBe('segmented');
  });

  it('开启参数搜索时返回网格搜索结果', () => {
    const result = runSimulation(scenario, { searchSpace: true });
    expect(result.strategySearch).not.toBeNull();
    expect(result.strategySearch!.evaluated).toBeGreaterThanOrEqual(20);
    expect(result.strategySearch!.top.length).toBe(3);
  });
});

describe('合规硬边界真实生效', () => {
  const scenario: ScenarioConfig = { ...defaultScenario, marketShock: -0.3, durationHours: 48, customerCount: 300, timeSteps: 10 };

  it('关闭合规层会改变数值结果：拦截不是纯文本改写', () => {
    const kept = runSimulation(scenario).strategies.find((item) => item.id === 'broadcast')!;
    const removed = runSimulation(scenario, { ablations: { disableCompliance: true } }).strategies.find((item) => item.id === 'broadcast')!;
    expect(kept.peakPanic).not.toBe(removed.peakPanic);
    expect(kept.finalComplaint).not.toBe(removed.finalComplaint);
  });

  it('被拦截的违规草稿有明确标记与改写文本', () => {
    const broadcast = runSimulation(scenario).strategies.find((item) => item.id === 'broadcast')!;
    expect(broadcast.findings.some((finding) => finding.status === '已拦截')).toBe(true);
    expect(broadcast.effectiveDraftText).not.toContain('务必立即行动');
  });
});

describe('存量适当性风险是可变量', () => {
  it('适当性发现随客户结构与种子变化，不再是各场景恒定的一条', () => {
    const detailOf = (config: ScenarioConfig) =>
      runSimulation(config).findings.find((finding) => finding.rule === 'SUITABILITY-MATRIX-01')?.detail ?? '未命中';
    const first = detailOf({ ...defaultScenario, marketShock: -0.1, customerCount: 200, seed: 20260830 });
    const second = detailOf({ ...defaultScenario, marketShock: -0.5, customerCount: 400, seed: 99 });
    expect(first).not.toBe(second);
  });

  it('多数客户的持仓与其风险承受等级匹配，越级持有只占少数', () => {
    const customers = generateCustomers(300, 20260830, 0.1);
    const order = ['C1', 'C2', 'C3', 'C4', 'C5'];
    const blocked = customers.filter((customer) => customer.productRisk - (order.indexOf(customer.riskLevel) + 1) >= 2);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.length / customers.length).toBeLessThan(0.2);
  });
});

describe('消融彻底性', () => {
  it('关闭心理层会同时重算持仓弹性与回撤', () => {
    const result = runSimulation({ ...defaultScenario, customerCount: 150 }, { ablations: { disablePsychology: true } });
    result.customers.forEach((customer) => {
      expect(customer.psychology.lossAversion).toBe(0.5);
      expect(customer.holdingBeta).toBeGreaterThan(0.4);
      expect(customer.holdingBeta).toBeLessThan(1.2);
    });
  });
});

describe('结论对效用权重的稳健性', () => {
  it('跌幅越大、推荐方案的人工深度不下降——默认与中等效用权重下全部成立', () => {
    const weightSets = [
      { cost: 0.02, wake: 0 },
      { cost: 0.1, wake: 2 },
      { cost: 0.1, wake: 8 },
      { cost: 0.5, wake: 0 },
    ];
    const shocks = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5];
    const durations = [6, 24, 72];
    const seedList = [20260830, 7];
    const segmentList: Array<'high_volatility_drawdown' | 'all_customers'> = ['high_volatility_drawdown', 'all_customers'];
    let sequences = 0;
    const violations: string[] = [];
    for (const utilityWeights of weightSets) {
      for (const durationHours of durations) {
        for (const seed of seedList) {
          for (const targetSegment of segmentList) {
            sequences += 1;
            let previous = -1;
            for (const shock of shocks) {
              const result = runSimulation(
                { ...defaultScenario, marketShock: -shock, durationHours, customerCount: 200, timeSteps: 8, seed, targetSegment },
                { utilityWeights },
              );
              const depth = strategyDefinitions.find((item) => item.id === result.recommended)!.depth;
              if (depth < previous - 1e-9) {
                violations.push(`成本=${utilityWeights.cost} 唤醒=${utilityWeights.wake} ${durationHours}h seed=${seed} ${targetSegment} ${shock}`);
              }
              previous = depth;
            }
          }
        }
      }
    }
    expect(sequences).toBe(48);
    expect(sequences).toBe(48);
    // 已实测的边界：违反只出现在「打扰权重 = 8 且时长 6 小时」这一极端配置的 40%→50% 区间。
    // 机制是唤醒罚分随恐慌上升衰减、而 λ_wake 把它放大 8 倍，广播式的唤醒基数更大因而减负更多；
    // 人工成本不随恐慌衰减，于是推荐在高冲击档翻回低成本的广播式。这是模型的已知边界，不是断言的数量目标，
    // 因此这里断言的是「违反只出现在该配置」这一性质，而不是精确条数——引擎微调不该让测试变红。
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every((item) => item.includes('唤醒=8') && item.includes('6h'))).toBe(true);
    expect(violations.length).toBeLessThanOrEqual(sequences * 0.1);
  });


  it('只改触达覆盖率就会改变模拟结果，覆盖率不是装饰数字', () => {
    const scenario: ScenarioConfig = { ...defaultScenario, marketShock: -0.3, customerCount: 200, timeSteps: 8 };
    const low = simulateWithLevers(scenario, { reach: 0.25, depth: 0.25, personalize: 0.45 });
    const high = simulateWithLevers(scenario, { reach: 0.95, depth: 0.25, personalize: 0.45 });
    expect(high.peakPanic).toBeLessThan(low.peakPanic);
    expect(high.touchCost).toBeGreaterThan(low.touchCost);
    expect(high.coverage).toBeGreaterThan(low.coverage);
  });
});


describe('相对分展示口径', () => {
  it('四项相对分可按公式逐项相减得到综合推荐度（含推荐为非基线的场景）', () => {
    // 10% 档推荐恰好是基线，差值为 0，正负号错误会被完全掩盖；这里必须覆盖非基线推荐的场景。
    for (const marketShock of [-0.1, -0.2, -0.5]) {
      const result = runSimulation({ ...defaultScenario, marketShock, customerCount: 300, timeSteps: 10 });
      const baseline = result.strategies.find((item) => item.id === 'baseline')!;
      const breakdown = relativeUtilityBreakdown(
        result.utilityWeights,
        baseline.utility,
        result.strategies.map((item) => item.utility),
      );
      result.strategies.forEach((item, index) => {
        const row = breakdown.all[index];
        expect(row.total).toBeCloseTo(row.avoidance - row.cost - row.wake, 6);
      });
      // 基线自身四项全为 0
      expect(breakdown.baseline.total).toBeCloseTo(0, 9);
      expect(breakdown.baseline.cost).toBeCloseTo(0, 9);
      expect(breakdown.baseline.wake).toBeCloseTo(0, 9);
    }
    // 确认确实覆盖到了「推荐不是基线」的情形
    const severe = runSimulation({ ...defaultScenario, marketShock: -0.5, customerCount: 300, timeSteps: 10 });
    expect(severe.recommended).not.toBe('baseline');
  });
});
