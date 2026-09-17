import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMemoryStore } from '../lib/harness/memory-store';
import { planSteps } from '../lib/harness/planner';
import { runTask } from '../lib/harness/runner';
import { readRuntimeEnv } from '../lib/harness/env';
import { loadModelConfig } from '../lib/model/adapter';
import type { HarnessEvent, TaskPlan } from '../lib/harness/types';
import type { ScenarioConfig } from '../lib/scenario';

export type TaskEvalCase = {
  id: string;
  category?: string;
  prompt: string;
  expect: Partial<ScenarioConfig>;
};

export type TaskEvalResult = {
  id: string;
  category: string;
  status: string;
  /** 工具链是否完整：8 个标准步骤齐全且顺序一致。 */
  chainOk: boolean;
  scenarioOk: boolean;
  toolsOk: boolean;
  /** 规划来源：rule=内置模板，llm=模型产出被采纳，degraded=模型调用失败回落。 */
  planSource: string;
  durationMs: number;
  missingTools: string[];
  failedSteps: string[];
  mismatches: string[];
};

export type PlanEvalReport = {
  generatedAt: string;
  total: number;
  /**
   * 工具链完整率：8 个标准步骤齐全且顺序一致的占比。
   * 未配置模型密钥时，规划走内置模板，该比率退化为确定性流水线的冒烟测试，
   * 不能解释为模型规划能力——真实规划能力看 planSourceCounts 里的 llm 占比。
   */
  chainSuccessRate: number;
  toolSuccessRate: number;
  scenarioSuccessRate: number;
  planSourceCounts: Record<string, number>;
  modelConfigured: boolean;
  threshold: number;
  passed: boolean;
  results: TaskEvalResult[];
};

export function loadTaskEvalCases(path = resolve(process.cwd(), 'evals', 'tasks.jsonl')): TaskEvalCase[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TaskEvalCase);
}

function rate(count: number, total: number) {
  return total === 0 ? 0 : Number((count / total).toFixed(4));
}

/**
 * 标准任务集评测。
 * 三条指标都必须有失败的可能：工具链可能缺步、场景抽取可能抽错、任务可能失败。
 * 配置了模型密钥时会真实调用模型，此时 llm 占比才反映模型的规划能力。
 */
export async function runPlanEval(cases: TaskEvalCase[] = loadTaskEvalCases(), threshold = 0.9): Promise<PlanEvalReport> {
  const config = loadModelConfig(await readRuntimeEnv());
  const results: TaskEvalResult[] = [];
  const expectedTools = planSteps.map((step) => step.tool);

  for (const item of cases) {
    const store = createMemoryStore({ id: item.id, prompt: item.prompt });
    const startedAt = Date.now();
    let status = 'failed';
    let failedSteps: string[] = [];
    try {
      const outcome = await runTask({ store, config, taskId: item.id, prompt: item.prompt });
      status = outcome.status;
      failedSteps = outcome.events.filter((event) => event.type === 'step.failed').map((event) => String(event.payload.tool));
    } catch (error) {
      failedSteps = [error instanceof Error ? error.message : 'unknown'];
    }

    const snapshot = store.snapshot();
    const events = snapshot.events as HarnessEvent[];
    const planEvent = events.find((event) => event.type === 'task.status' && event.payload.plan);
    const plan = (planEvent?.payload.plan as TaskPlan | undefined) ?? null;
    const completedTools = events.filter((event) => event.type === 'step.completed').map((event) => String(event.payload.tool));
    const missingTools = expectedTools.filter((tool) => !completedTools.includes(tool));
    const scenarioEvent = events.find((event) => event.type === 'step.completed' && event.payload.tool === 'scenario.extract');
    const scenario = ((scenarioEvent?.payload.payload as { scenario?: ScenarioConfig } | undefined)?.scenario) ?? null;

    const mismatches: string[] = [];
    if (!scenario) {
      mismatches.push('未抽取到场景配置');
    } else {
      for (const [key, value] of Object.entries(item.expect)) {
        const actual = (scenario as unknown as Record<string, unknown>)[key];
        if (actual !== value) mismatches.push(key + '：期望 ' + String(value) + '，实际 ' + String(actual));
      }
    }

    const chainOk = Boolean(
      plan && plan.steps.length === expectedTools.length && plan.steps.every((step, index) => step.tool === expectedTools[index]),
    );
    const toolsOk = status === 'succeeded' && missingTools.length === 0;
    results.push({
      id: item.id,
      category: item.category ?? '未分类',
      status,
      chainOk,
      scenarioOk: mismatches.length === 0,
      toolsOk,
      planSource: plan?.source ?? 'none',
      durationMs: Date.now() - startedAt,
      missingTools,
      failedSteps,
      mismatches,
    });
  }

  const total = results.length;
  const chainSuccessRate = rate(results.filter((result) => result.chainOk).length, total);
  const toolSuccessRate = rate(results.filter((result) => result.toolsOk).length, total);
  const scenarioSuccessRate = rate(results.filter((result) => result.scenarioOk).length, total);
  const planSourceCounts: Record<string, number> = {};
  for (const result of results) {
    planSourceCounts[result.planSource] = (planSourceCounts[result.planSource] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    total,
    chainSuccessRate,
    toolSuccessRate,
    scenarioSuccessRate,
    planSourceCounts,
    modelConfigured: config !== null,
    threshold,
    // 场景抽取必须一并达标：只校验工具链会放过「抽取全错但流程跑通」的情况。
    passed: chainSuccessRate >= threshold && toolSuccessRate >= threshold && scenarioSuccessRate >= threshold,
    results,
  };
}

export function formatPlanEval(report: PlanEvalReport) {
  const pct = (value: number) => (value * 100).toFixed(1) + '%';
  const lines = [
    '# 标准任务集评测',
    '',
    '- 任务数：' + report.total,
    '- 模型配置：' + (report.modelConfigured ? '已接入' : '未接入（规划走内置模板）'),
    '- 规划来源分布：' + Object.entries(report.planSourceCounts).map(([key, value]) => key + '=' + value).join('，'),
    '- 工具链完整率：' + pct(report.chainSuccessRate) + '（阈值 ' + pct(report.threshold) + '）',
    '- 工具调用成功率：' + pct(report.toolSuccessRate) + '（阈值 ' + pct(report.threshold) + '）',
    '- 场景抽取一致率：' + pct(report.scenarioSuccessRate) + '（阈值 ' + pct(report.threshold) + '）',
    '- 结论：' + (report.passed ? '通过' : '未通过'),
    '',
    report.modelConfigured
      ? '> 已接入模型：规划来源中的 llm 占比反映模型产出被采纳的比例。'
      : '> 未接入模型：规划走内置模板，工具链完整率是确定性流水线的冒烟测试，不代表模型规划能力；模型的规划能力需接入密钥后看 llm 占比。',
    '',
    '| 任务 | 分类 | 状态 | 工具链 | 场景 | 工具 | 规划来源 | 耗时(ms) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const result of report.results) {
    lines.push(
      '| ' + result.id + ' | ' + result.category + ' | ' + result.status + ' | ' + (result.chainOk ? '✓' : '✗') + ' | ' + (result.scenarioOk ? '✓' : '✗') + ' | ' + (result.toolsOk ? '✓' : '✗') + ' | ' + result.planSource + ' | ' + result.durationMs + ' |',
    );
  }
  const problems = report.results.filter((result) => !result.chainOk || !result.scenarioOk || !result.toolsOk);
  if (problems.length) {
    lines.push('', '## 失败明细', '');
    for (const problem of problems) {
      lines.push('- ' + problem.id + '：' + [...problem.mismatches, ...problem.missingTools.map((tool) => '缺少工具 ' + tool), ...problem.failedSteps].join('；'));
    }
  }
  return lines.join('\n');
}

async function main() {
  const report = await runPlanEval();
  console.log(formatPlanEval(report));
  if (!report.passed) process.exitCode = 1;
}

const invokedDirectly = process.argv[1]?.includes('eval-plan');
if (invokedDirectly) await main();
