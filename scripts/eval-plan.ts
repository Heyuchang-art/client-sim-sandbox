import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMemoryStore } from '../lib/harness/memory-store';
import { planSteps } from '../lib/harness/planner';
import { runTask } from '../lib/harness/runner';
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
  planOk: boolean;
  scenarioOk: boolean;
  toolsOk: boolean;
  durationMs: number;
  missingTools: string[];
  failedSteps: string[];
  mismatches: string[];
};

export type PlanEvalReport = {
  generatedAt: string;
  total: number;
  planSuccessRate: number;
  toolSuccessRate: number;
  scenarioSuccessRate: number;
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
 * 标准任务集评测：逐条执行 Harness，统计规划成功率、场景抽取成功率与工具调用成功率。
 * 规划成功 = 8 个标准工具步骤齐全且顺序一致；工具调用成功 = 任务成功且无步骤缺失。
 */
export async function runPlanEval(cases: TaskEvalCase[] = loadTaskEvalCases(), threshold = 0.9): Promise<PlanEvalReport> {
  const results: TaskEvalResult[] = [];
  const expectedTools = planSteps.map((step) => step.tool);

  for (const item of cases) {
    const store = createMemoryStore({ id: item.id, prompt: item.prompt });
    const startedAt = Date.now();
    let status = 'failed';
    let failedSteps: string[] = [];
    try {
      const outcome = await runTask({ store, config: null, taskId: item.id, prompt: item.prompt });
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

    const planOk = Boolean(
      plan && plan.steps.length === expectedTools.length && plan.steps.every((step, index) => step.tool === expectedTools[index]),
    );
    const toolsOk = status === 'succeeded' && missingTools.length === 0;
    results.push({
      id: item.id,
      category: item.category ?? '未分类',
      status,
      planOk,
      scenarioOk: mismatches.length === 0,
      toolsOk,
      durationMs: Date.now() - startedAt,
      missingTools,
      failedSteps,
      mismatches,
    });
  }

  const total = results.length;
  const planSuccessRate = rate(results.filter((result) => result.planOk).length, total);
  const toolSuccessRate = rate(results.filter((result) => result.toolsOk).length, total);
  const scenarioSuccessRate = rate(results.filter((result) => result.scenarioOk).length, total);

  return {
    generatedAt: new Date().toISOString(),
    total,
    planSuccessRate,
    toolSuccessRate,
    scenarioSuccessRate,
    threshold,
    passed: planSuccessRate >= threshold && toolSuccessRate >= threshold,
    results,
  };
}

export function formatPlanEval(report: PlanEvalReport) {
  const lines = [
    '# 标准任务集评测',
    '',
    '- 任务数：' + report.total,
    '- 规划成功率：' + (report.planSuccessRate * 100).toFixed(1) + '%（阈值 ' + (report.threshold * 100).toFixed(0) + '%）',
    '- 工具调用成功率：' + (report.toolSuccessRate * 100).toFixed(1) + '%（阈值 ' + (report.threshold * 100).toFixed(0) + '%）',
    '- 场景抽取一致率：' + (report.scenarioSuccessRate * 100).toFixed(1) + '%',
    '- 结论：' + (report.passed ? '通过' : '未通过'),
    '',
    '| 任务 | 分类 | 状态 | 规划 | 场景 | 工具 | 耗时(ms) |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const result of report.results) {
    lines.push(
      '| ' + result.id + ' | ' + result.category + ' | ' + result.status + ' | ' + (result.planOk ? '✓' : '✗') + ' | ' + (result.scenarioOk ? '✓' : '✗') + ' | ' + (result.toolsOk ? '✓' : '✗') + ' | ' + result.durationMs + ' |',
    );
  }
  const problems = report.results.filter((result) => !result.planOk || !result.scenarioOk || !result.toolsOk);
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
