import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aggregateSignature, runSimulation, type AblationFlags, type StrategyId } from '../lib/simulation';
import { RULE_VERSION, checkText } from '../lib/compliance';
import { compareModes, compareModesAcrossScenarios, type ComparisonOutcome, type ScenarioComparison } from '../lib/baselines/compare';
import { defaultScenario, type ScenarioConfig } from '../lib/scenario';
import { formatStrategySweep, runStrategySweep, type StrategySweepReport } from './sweep-strategies';
import { runPlanEval, type PlanEvalReport } from './eval-plan';

const engineVersion = (JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version;

export type EngineRun = {
  label: string;
  customers: number;
  timeSteps: number;
  seed: number;
  runs: number[];
  medianMs: number;
  aggregateHash: string;
  peakPanic: number;
  finalSell: number;
  finalChurn: number;
};

export type ComplianceEval = {
  total: number;
  blocked: number;
  review: number;
  clean: number;
  recall: number;
  blockedRecall: number;
  reviewRecall: number;
  falseBlockRate: number;
  passed: boolean;
  missed: string[];
  falseBlocked: string[];
};

export type MetricsReport = {
  generatedAt: string;
  version: string;
  ruleVersion: string;
  environment: { node: string; platform: string; modelConfigured: boolean };
  thresholds: Record<string, { value: number; comparator: '>=' | '<='; label: string }>;
  engine: EngineRun[];
  determinism: { repeats: number; identical: boolean; hash: string };
  shockSensitivity: Array<{
    shock: number;
    recommended: string;
    peakPanic: number;
    finalSell: number;
    finalChurn: number;
    baselinePeakPanic: number;
    baselineFinalSell: number;
    baselineFinalChurn: number;
    peakStep: number;
  }>;
  shockMonotonic: boolean;
  durationSensitivity: Array<{ durationHours: number; stepHours: number; peakPanic: number; peakStep: number; finalSell: number }>;
  durationDirectional: boolean;
  segment: { criteria: string; generated: number; matched: number; excluded: number; relaxed: boolean; reproducibility: boolean };
  ablations: Array<{ name: string; peakPanic: number; finalSell: number; finalChurn: number; deltaPeakPanic: number; deltaFinalSell: number; broadcastPeakPanic: number; broadcastDeltaPeakPanic: number }>;
  modes: ComparisonOutcome[];
  modeByScenario: ScenarioComparison[];
  compliance: ComplianceEval;
  planEval: { total: number; chainSuccessRate: number; toolSuccessRate: number; scenarioSuccessRate: number; planSourceCounts: Record<string, number>; modelConfigured: boolean; passed: boolean };
  server: { baseUrl: string; sseFirstFrameMs: number; endToEndMs: number } | null;
  strategySweep: StrategySweepReport;
  acceptance: Array<{ item: string; target: string; actual: string; passed: boolean | null }>;
};

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2)) : sorted[middle];
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function measureEngine(label: string, scenario: ScenarioConfig, runs = 5): EngineRun {
  const durations: number[] = [];
  let signature = '';
  let peakPanic = 0;
  let finalSell = 0;
  let finalChurn = 0;
  for (let index = 0; index < runs; index += 1) {
    const startedAt = performance.now();
    const result = runSimulation(scenario);
    durations.push(Number((performance.now() - startedAt).toFixed(2)));
    const recommended = result.strategies.find((strategy) => strategy.id === result.recommended) ?? result.strategies[0];
    if (index === 0) {
      signature = aggregateSignature(result);
      peakPanic = Number(recommended.peakPanic.toFixed(4));
      finalSell = Number(recommended.finalSell.toFixed(4));
      finalChurn = Number(recommended.finalChurn.toFixed(4));
    }
  }
  return {
    label,
    customers: scenario.customerCount,
    timeSteps: scenario.timeSteps,
    seed: scenario.seed,
    runs: durations,
    medianMs: median(durations),
    aggregateHash: hash(signature),
    peakPanic,
    finalSell,
    finalChurn,
  };
}

function peakStepOf(result: ReturnType<typeof runSimulation>) {
  const recommended = result.strategies.find((strategy) => strategy.id === result.recommended) ?? result.strategies[0];
  let peak = -1;
  let step = 1;
  recommended.snapshots.forEach((snapshot, index) => {
    if (snapshot.panic > peak) {
      peak = snapshot.panic;
      step = index + 1;
    }
  });
  return step;
}

export function evaluateComplianceCorpus(): ComplianceEval {
  const path = resolve(process.cwd(), 'evals', 'compliance-corpus.jsonl');
  const samples = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id: string; label: 'blocked' | 'review' | 'clean'; text: string });

  let blocked = 0;
  let review = 0;
  let clean = 0;
  let blockedLabeled = 0;
  let blockedCaught = 0;
  let reviewLabeled = 0;
  let reviewCaught = 0;
  const missed: string[] = [];
  const falseBlocked: string[] = [];

  for (const sample of samples) {
    const { findings } = checkText(sample.text, { scope: 'message', label: sample.id });
    const hasBlock = findings.some((finding) => finding.severity === '阻断');
    const hasReview = findings.some((finding) => finding.severity === '警告');
    if (hasBlock) blocked += 1;
    else if (hasReview) review += 1;
    else clean += 1;

    if (sample.label === 'blocked') {
      blockedLabeled += 1;
      if (hasBlock) blockedCaught += 1;
      else missed.push(sample.id + '(blocked)');
    }
    if (sample.label === 'review') {
      reviewLabeled += 1;
      if (hasBlock || hasReview) reviewCaught += 1;
      else missed.push(sample.id + '(review)');
    }
    if (sample.label === 'clean' && hasBlock) falseBlocked.push(sample.id);
  }

  // 召回口径：禁止性样例必须被阻断；待复核样例命中阻断或警告即视为召回；
  // 干净样例只要被阻断即计入误拦截。
  const blockedRecall = blockedLabeled === 0 ? 1 : blockedCaught / blockedLabeled;
  const reviewRecall = reviewLabeled === 0 ? 1 : reviewCaught / reviewLabeled;
  const recall = blockedLabeled + reviewLabeled === 0 ? 1 : (blockedCaught + reviewCaught) / (blockedLabeled + reviewLabeled);
  const cleanTotal = samples.filter((sample) => sample.label === 'clean').length;
  const falseBlockRate = cleanTotal === 0 ? 0 : falseBlocked.length / cleanTotal;

  return {
    total: samples.length,
    blocked,
    review,
    clean,
    recall: Number(recall.toFixed(4)),
    blockedRecall: Number(blockedRecall.toFixed(4)),
    reviewRecall: Number(reviewRecall.toFixed(4)),
    falseBlockRate: Number(falseBlockRate.toFixed(4)),
    passed: blockedRecall >= 0.95 && falseBlockRate <= 0.1,
    missed,
    falseBlocked,
  };
}

/** 可选：对运行中的服务做 SSE 首帧与端到端耗时实测（本地与部署各测一次）。 */
async function measureServer(baseUrl: string) {
  const startedAt = Date.now();
  const response = await fetch(baseUrl + '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '市场下跌 20%，请模拟 24 小时、300 名高波动回撤客户的群体反应。' }),
  });
  if (!response.ok) throw new Error('task-submit-failed:' + response.status);
  const submitted = (await response.json()) as { taskId: string };

  let sseFirstFrameMs = 0;
  let endToEndMs = 0;
  const controller = new AbortController();
  const stream = await fetch(baseUrl + '/api/tasks/' + submitted.taskId + '/events', { signal: controller.signal });
  const reader = stream.body?.getReader();
  if (!reader) return { baseUrl, sseFirstFrameMs: 0, endToEndMs: Date.now() - startedAt };
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    if (sseFirstFrameMs === 0 && buffer.includes('event:')) sseFirstFrameMs = Date.now() - startedAt;
    if (buffer.includes('event: task.completed') || buffer.includes('event: task.failed')) {
      endToEndMs = Date.now() - startedAt;
      break;
    }
  }
  controller.abort();
  return { baseUrl, sseFirstFrameMs, endToEndMs };
}

export async function runBenchmark(): Promise<MetricsReport> {
  const base = { ...defaultScenario };
  const engine = [
    measureEngine('300×10', { ...base, customerCount: 300, timeSteps: 10 }),
    measureEngine('1000×20', { ...base, customerCount: 1000, timeSteps: 20 }, 3),
  ];

  const repeats = 5;
  const signatures = Array.from({ length: repeats }, () => aggregateSignature(runSimulation(base)));
  const determinism = {
    repeats,
    identical: new Set(signatures).size === 1,
    hash: hash(signatures[0]),
  };

  const shockLevels = [0.1, 0.2, 0.3];
  const shockRuns = shockLevels.map((shock) => runSimulation({ ...base, marketShock: -shock }));
  const shockSensitivity = shockRuns.map((result, index) => {
    const recommended = result.strategies.find((strategy) => strategy.id === result.recommended) ?? result.strategies[0];
    const baselineStrategy = result.strategies.find((strategy) => strategy.id === 'baseline') ?? result.strategies[0];
    return {
      shock: shockLevels[index],
      recommended: recommended.id,
      peakPanic: Number(recommended.peakPanic.toFixed(4)),
      finalSell: Number(recommended.finalSell.toFixed(4)),
      finalChurn: Number(recommended.finalChurn.toFixed(4)),
      baselinePeakPanic: Number(baselineStrategy.peakPanic.toFixed(4)),
      baselineFinalSell: Number(baselineStrategy.finalSell.toFixed(4)),
      baselineFinalChurn: Number(baselineStrategy.finalChurn.toFixed(4)),
      peakStep: peakStepOf(result),
    };
  });
  // 单调性按“同一策略跨冲击”逐条比对：推荐策略会随冲击切换，混比会得出错误结论。
  const monotonicLevels = [
    (strategy: (typeof shockRuns)[number]['strategies'][number]) => strategy.peakPanic,
    (strategy: (typeof shockRuns)[number]['strategies'][number]) => strategy.finalSell,
    (strategy: (typeof shockRuns)[number]['strategies'][number]) => strategy.finalChurn,
  ];
  // 验收标准针对的是「基线」恐慌、卖出与流失不随冲击反向下降，
  // 因此这里对基线策略做严格单调校验；其余策略的敏感性单独披露，
  // 因为它们会随干预强度变化而出现千分之一量级的波动。
  const seriesOf = (id: StrategyId) => shockRuns.map((result) => result.strategies.find((item) => item.id === id) ?? result.strategies[0]);
  const worstReversalOf = (series: typeof shockRuns[number]['strategies']) =>
    Math.max(...monotonicLevels.map((pick) => Math.max(0, pick(series[1]) - pick(series[2]), pick(series[0]) - pick(series[1]))));
  const baselineSeries = seriesOf('baseline');
  const shockMonotonic = monotonicLevels.every(
    (pick) => pick(baselineSeries[1]) >= pick(baselineSeries[0]) - 1e-9 && pick(baselineSeries[2]) >= pick(baselineSeries[1]) - 1e-9,
  );
  const otherReversals = (['broadcast', 'segmented'] as StrategyId[])
    .map((id) => ({ id, reversal: worstReversalOf(seriesOf(id)) }))
    .filter((item) => item.reversal > 1e-9);
  const shockReversalNote = otherReversals.length === 0
    ? '其余策略同样单调'
    : otherReversals.map((item) => `${item.id} 最大反向 ${item.reversal.toFixed(4)}`).join('、');

  // 消融与时长对比固定在“不主动沟通”策略上，隔离推荐策略切换带来的干扰。
  const referenceStrategyId: StrategyId = 'baseline';
  const durationSensitivity = [24, 48, 72].map((durationHours) => {
    const scenario: ScenarioConfig = { ...base, durationHours };
    const result = runSimulation(scenario);
    const recommended = result.strategies.find((strategy) => strategy.id === referenceStrategyId) ?? result.strategies[0];
    return {
      durationHours,
      stepHours: Number((durationHours / scenario.timeSteps).toFixed(2)),
      peakPanic: Number(recommended.peakPanic.toFixed(4)),
      peakStep: peakStepOf(result),
      finalSell: Number(recommended.finalSell.toFixed(4)),
    };
  });
  const durationDirectional = durationSensitivity[durationSensitivity.length - 1].peakStep >= durationSensitivity[0].peakStep
    && durationSensitivity[durationSensitivity.length - 1].peakPanic >= durationSensitivity[0].peakPanic;

  const segmentResult = runSimulation(base);
  const segment = {
    criteria: segmentResult.scenarioMeta.segmentCriteria,
    generated: segmentResult.scenarioMeta.generatedCustomers,
    matched: segmentResult.customerCount,
    excluded: segmentResult.scenarioMeta.excludedCustomers,
    relaxed: segmentResult.scenarioMeta.segmentRelaxed,
    reproducibility: aggregateSignature(segmentResult) === aggregateSignature(runSimulation(base)),
  };

  const full = runSimulation(base);
  const fullRecommended = full.strategies.find((strategy) => strategy.id === referenceStrategyId) ?? full.strategies[0];
  const ablationDefs: Array<{ name: string; flags: AblationFlags }> = [
    { name: 'disablePsychology', flags: { disablePsychology: true } },
    { name: 'disableContagion', flags: { disableContagion: true } },
    { name: 'disableMemory', flags: { disableMemory: true } },
    { name: 'disableCompliance', flags: { disableCompliance: true } },
  ];
  // 合规层只作用于带违规草稿的策略，因此除基线参照外，另记录统一风险提示策略的数值，
  const fullBroadcast = full.strategies.find((strategy) => strategy.id === 'broadcast') ?? full.strategies[0];
  const ablations = ablationDefs.map((definition) => {
    const result = runSimulation(base, { ablations: definition.flags });
    const recommended = result.strategies.find((strategy) => strategy.id === referenceStrategyId) ?? result.strategies[0];
    const broadcast = result.strategies.find((strategy) => strategy.id === 'broadcast') ?? result.strategies[0];
    return {
      name: definition.name,
      peakPanic: Number(recommended.peakPanic.toFixed(4)),
      finalSell: Number(recommended.finalSell.toFixed(4)),
      finalChurn: Number(recommended.finalChurn.toFixed(4)),
      deltaPeakPanic: Number((recommended.peakPanic - fullRecommended.peakPanic).toFixed(4)),
      deltaFinalSell: Number((recommended.finalSell - fullRecommended.finalSell).toFixed(4)),
      broadcastPeakPanic: Number(broadcast.peakPanic.toFixed(4)),
      broadcastDeltaPeakPanic: Number((broadcast.peakPanic - fullBroadcast.peakPanic).toFixed(4)),
    };
  });


  const strategySweep = runStrategySweep();
  const { outcomes: modes } = compareModes(base, { repeats: 3 });
  const modeByScenario = compareModesAcrossScenarios(base, [0.05, 0.2, 0.5], { repeats: 3 });
  const compliance = evaluateComplianceCorpus();
  const planReport: PlanEvalReport = await runPlanEval();
  const baseUrl = process.env.BENCHMARK_BASE_URL;
  const server = baseUrl ? await measureServer(baseUrl.replace(/\/$/, '')) : null;

  const acceptance = [
    { item: '标准任务工具链完整率', target: '≥ 90%', actual: (planReport.chainSuccessRate * 100).toFixed(1) + '%', passed: planReport.chainSuccessRate >= planReport.threshold },
    { item: '标准任务工具调用成功率', target: '≥ 90%', actual: (planReport.toolSuccessRate * 100).toFixed(1) + '%', passed: planReport.toolSuccessRate >= planReport.threshold },
    { item: '标准任务场景抽取一致率', target: '≥ 90%', actual: (planReport.scenarioSuccessRate * 100).toFixed(1) + '%', passed: planReport.scenarioSuccessRate >= planReport.threshold },
    { item: '模型规划产出被采纳占比', target: '记录值', actual: planReport.modelConfigured ? (((planReport.planSourceCounts.llm ?? 0) / planReport.total) * 100).toFixed(1) + '%' : '未接入模型（规划走内置模板）', passed: null },
    { item: '300×10 引擎耗时', target: '< 30000 ms', actual: engine[0].medianMs + ' ms', passed: engine[0].medianMs < 30000 },
    { item: '1000×20 引擎耗时', target: '< 30000 ms', actual: engine[1].medianMs + ' ms', passed: engine[1].medianMs < 30000 },
    { item: '同种子完全复现', target: '签名一致', actual: determinism.identical ? '一致' : '不一致', passed: determinism.identical },
    { item: '基线恐慌/卖出/流失随跌幅不反向', target: '不下降', actual: (shockMonotonic ? '单调成立' : '存在反向') + '；' + shockReversalNote, passed: shockMonotonic },
    { item: '时长 24h→72h 方向一致', target: '峰值不下降（现有参数下峰值恒在首步，差异体现在高度）', actual: durationDirectional ? '方向一致' : '方向不一致', passed: durationDirectional },
    { item: '禁止性合规样例召回', target: '≥ 95%', actual: (compliance.blockedRecall * 100).toFixed(1) + '%', passed: compliance.blockedRecall >= 0.95 },
    { item: '待复核样例召回', target: '记录值', actual: (compliance.reviewRecall * 100).toFixed(1) + '%', passed: compliance.reviewRecall >= 0.8 },
    { item: '合规误拦截', target: '≤ 10%', actual: (compliance.falseBlockRate * 100).toFixed(1) + '%', passed: compliance.falseBlockRate <= 0.1 },
    { item: '沟通策略验收（与效用权重无关的结构性质）', target: '全部成立', actual: strategySweep.passed ? '全部通过' : '存在未通过项', passed: strategySweep.passed },
    { item: '夺冠配比（λ 相关，仅记录不作门禁）', target: '记录值', actual: Object.entries(strategySweep.wins).map(([id, count]) => id + ' ' + ((count / strategySweep.scenarios) * 100).toFixed(1) + '%').join(' · '), passed: null },
  ];

  return {
    generatedAt: new Date().toISOString(),
    version: engineVersion,
    ruleVersion: RULE_VERSION,
    environment: {
      node: process.version,
      platform: process.platform,
      modelConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
    },
    thresholds: {
      planSuccessRate: { value: 0.9, comparator: '>=', label: '工具链完整率与工具调用成功率' },
      engineMs: { value: 30000, comparator: '<=', label: '300×10 引擎耗时上限（毫秒）' },
      sseFirstFrameMs: { value: 2000, comparator: '<=', label: 'SSE 首帧上限（毫秒）' },
      complianceRecall: { value: 0.95, comparator: '>=', label: '合规召回率' },
      complianceFalseBlock: { value: 0.1, comparator: '<=', label: '合规误拦截率' },
    },
    engine,
    determinism,
    shockSensitivity,
    shockMonotonic,
    durationSensitivity,
    durationDirectional,
    segment,
    ablations,
    modes,
    modeByScenario,
    compliance,
    planEval: {
      total: planReport.total,
      chainSuccessRate: planReport.chainSuccessRate,
      toolSuccessRate: planReport.toolSuccessRate,
      scenarioSuccessRate: planReport.scenarioSuccessRate,
      planSourceCounts: planReport.planSourceCounts,
      modelConfigured: planReport.modelConfigured,
      passed: planReport.passed,
    },
    strategySweep,
    server,
    acceptance,
  };
}

export function formatMetrics(report: MetricsReport) {
  const lines = [
    '# 指标快照',
    '',
    '- 生成时间：' + report.generatedAt,
    '- 版本：v' + report.version + ' · 规则版本 ' + report.ruleVersion,
    '- 环境：Node ' + report.environment.node + ' · ' + report.environment.platform + ' · 模型密钥：' + (report.environment.modelConfigured ? '已配置' : '未配置（规则模式）'),
    '',
    '## 验收对照',
    '',
    '| 验收项 | 目标 | 实测 | 结论 |',
    '| --- | --- | --- | --- |',
  ];
  for (const item of report.acceptance) {
    const verdict = item.passed === null ? '待测' : item.passed ? '通过' : '未通过';
    lines.push('| ' + item.item + ' | ' + item.target + ' | ' + item.actual + ' | ' + verdict + ' |');
  }
  lines.push(
    '',
    '## 引擎耗时',
    '',
    '| 规模 | 中位耗时(ms) | 全部采样(ms) | 聚合哈希 | 恐慌峰值 | 卖出 | 流失 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const run of report.engine) {
    lines.push('| ' + run.label + ' | ' + run.medianMs + ' | ' + run.runs.join('/') + ' | ' + run.aggregateHash + ' | ' + run.peakPanic + ' | ' + run.finalSell + ' | ' + run.finalChurn + ' |');
  }
  lines.push(
    '',
    '## 参数敏感性',
    '',
    '| 市场跌幅 | 推荐策略 | 推荐：恐慌峰值 | 基线：恐慌峰值 | 基线：卖出 | 基线：流失 | 峰值时间步 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const item of report.shockSensitivity) {
    lines.push('| ' + (item.shock * 100).toFixed(0) + '% | ' + item.recommended + ' | ' + item.peakPanic + ' | ' + item.baselinePeakPanic + ' | ' + item.baselineFinalSell + ' | ' + item.baselineFinalChurn + ' | ' + item.peakStep + ' |');
  }
  lines.push('', '| 持续时间 | 每步小时 | 恐慌峰值（不主动沟通） | 峰值时间步 |', '| --- | --- | --- | --- |');
  for (const item of report.durationSensitivity) {
    lines.push('| ' + item.durationHours + 'h | ' + item.stepHours + ' | ' + item.peakPanic + ' | ' + item.peakStep + ' |');
  }
  lines.push(
    '',
    '## 消融实验（相对完整模型）',
    '',
    '| 关闭层 | 基线恐慌峰值 | 基线卖出 | 基线流失 | Δ恐慌(基线) | Δ卖出(基线) | 统一提示恐慌峰值 | Δ恐慌(统一提示) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const item of report.ablations) {
    lines.push('| ' + item.name + ' | ' + item.peakPanic + ' | ' + item.finalSell + ' | ' + item.finalChurn + ' | ' + item.deltaPeakPanic + ' | ' + item.deltaFinalSell + ' | ' + item.broadcastPeakPanic + ' | ' + item.broadcastDeltaPeakPanic + ' |');
  }
  lines.push(
    '',
    '## 对照模式',
    '',
    '| 模式 | 推荐策略 | 排序一致率 | 稳定性 | 耗时(ms) | 说明 |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const mode of report.modes) {
    lines.push('| ' + mode.label + ' | ' + mode.recommended + ' | ' + mode.rankAgreement + ' | ' + mode.stability + ' | ' + mode.latencyMs + ' | ' + mode.note + ' |');
  }
  lines.push(
    '',
    '## 合规语料',
    '',
    '- 样本 ' + report.compliance.total + ' 条（阻断 ' + report.compliance.blocked + ' / 待复核 ' + report.compliance.review + ' / 合规 ' + report.compliance.clean + '）',
    '- 禁止性召回 ' + (report.compliance.blockedRecall * 100).toFixed(1) + '% · 待复核召回 ' + (report.compliance.reviewRecall * 100).toFixed(1) + '% · 综合召回 ' + (report.compliance.recall * 100).toFixed(1) + '% · 误拦截率 ' + (report.compliance.falseBlockRate * 100).toFixed(1) + '%',
    '- 漏检：' + (report.compliance.missed.join('、') || '无'),
    '- 误拦截：' + (report.compliance.falseBlocked.join('、') || '无'),
    '',
    '## 标准任务集',
    '',
    '- ' + report.planEval.total + ' 个任务 · 工具链 ' + (report.planEval.chainSuccessRate * 100).toFixed(1) + '% · 工具 ' + (report.planEval.toolSuccessRate * 100).toFixed(1) + '% · 场景抽取 ' + (report.planEval.scenarioSuccessRate * 100).toFixed(1) + '%',
    report.planEval.modelConfigured
      ? '- 规划来源：' + Object.entries(report.planEval.planSourceCounts).map(([key, value]) => key + '=' + value).join('，')
      : '- 规划来源：未接入模型，全部走内置模板；工具链完整率是确定性流水线冒烟测试，不代表模型规划能力',
  );
  lines.push('', ...formatStrategySweep(report.strategySweep).split('\n'));
  lines.push('', '### 多场景对照（一致的结论必须跨场景成立）', '');
  lines.push('| 市场跌幅 | ' + report.modeByScenario[0].outcomes.map((item) => item.mode).join(' | ') + ' |');
  lines.push('| --- | ' + report.modeByScenario[0].outcomes.map(() => '---').join(' | ') + ' |');
  for (const row of report.modeByScenario) {
    lines.push('| ' + (row.shock * 100).toFixed(0) + '% | ' + row.outcomes.map((item) => item.recommended + (item.rankAgreement === 1 ? '（与推荐一致）' : '（一致率 ' + (item.rankAgreement * 100).toFixed(1) + '%）')).join(' | ') + ' |');
  }
  lines.push('', '> 上表按跌幅分别报告。任何一格出现「与推荐一致」都说明该档场景下文本类模式与本方案结论相同，因此不能只用默认场景的一格数字支撑「本方案必要」的一般性结论。');
  if (report.server) {
    lines.push('', '## 服务端实测', '', '- ' + report.server.baseUrl + ' · SSE 首帧 ' + report.server.sseFirstFrameMs + ' ms · 端到端 ' + report.server.endToEndMs + ' ms');
  }
  return lines.join('\n');
}

async function main() {
  const report = await runBenchmark();
  const directory = resolve(process.cwd(), 'artifacts', 'metrics');
  mkdirSync(directory, { recursive: true });
  const date = report.generatedAt.slice(0, 10);
  const jsonPath = resolve(directory, date + '-v' + report.version + '.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(resolve(directory, 'latest.md'), formatMetrics(report));
  console.log(formatMetrics(report));
  console.log('\n写入：' + jsonPath);
}

const invokedDirectly = process.argv[1]?.includes('benchmark');
if (invokedDirectly) await main();
