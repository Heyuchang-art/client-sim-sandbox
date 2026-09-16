import { defaultScenario } from '../scenario';
import { ModelUnavailableError, ModelTimeoutError, errorCodeOf, type ModelConfig } from '../model/adapter';
import { RULE_VERSION } from '../compliance';
import { defaultPlan, planTask } from './planner';
import { toolRegistry, type HarnessContext } from './tools';
import type { TaskStore } from './store';
import { buildSimulationRecord, buildStepStates } from './persist';
import type { HarnessEvent, HarnessEventType, TaskErrorCode, TaskMode, TaskPlan, TaskStatus } from './types';

export class TaskCancelledError extends Error {
  readonly code = 'CANCELLED' as const;
  constructor() {
    super('任务已被取消。');
    this.name = 'TaskCancelledError';
  }
}

export class TaskTimeoutError extends Error {
  readonly code = 'TASK_TIMEOUT' as const;
  constructor(message = '任务超出总时间预算。') {
    super(message);
    this.name = 'TaskTimeoutError';
  }
}

export type RunnerOptions = {
  store: TaskStore;
  config: ModelConfig | null;
  taskId: string;
  prompt: string;
  stepTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxAttempts?: number;
  now?: () => number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type TaskRunOutcome = {
  status: TaskStatus;
  mode: TaskMode;
  errorCode: TaskErrorCode | null;
  errorMessage: string | null;
  events: HarnessEvent[];
  simulationId: string | null;
  summaryJson: string | null;
};

function withTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isRetryable(error: unknown) {
  if (error instanceof ModelTimeoutError || error instanceof ModelUnavailableError) return true;
  return error instanceof Error && error.message === 'SIMULATION_FAILED';
}

export async function runTask(options: RunnerOptions): Promise<TaskRunOutcome> {
  const {
    store,
    config,
    taskId,
    prompt,
    stepTimeoutMs = 25000,
    totalTimeoutMs = 90000,
    maxAttempts = 2,
    now = () => Date.now(),
  } = options;

  const startedAt = now();
  const deadline = startedAt + totalTimeoutMs;
  const events: HarnessEvent[] = [];
  let sequence = 0;
  let mode: TaskMode = config ? 'llm' : 'rule';
  let model: string | null = config?.model ?? null;

  const emit = async (type: HarnessEventType, payload: Record<string, unknown>) => {
    sequence += 1;
    const event: HarnessEvent = { seq: sequence, type, at: now(), payload };
    events.push(event);
    await store.appendEvent({ ...event, taskId });
  };

  const currentStatus = async () => (await store.getTask(taskId))?.status ?? null;

  const ensureNotCancelled = async () => {
    const status = await currentStatus();
    if (status === 'cancel_requested' || status === 'cancelled') throw new TaskCancelledError();
    if (now() > deadline) throw new TaskTimeoutError();
  };

  const context: HarnessContext = {
    taskId,
    prompt,
    config,
    scenario: defaultScenario,
    scenarioDefaulted: [],
    scenarioNotes: [],
    scenarioSource: 'rule',
    model,
    pool: null,
    relationships: [],
    memory: [],
    strategyDrafts: [],
    strategySource: 'rule',
    result: null,
    findings: [],
    summary: null,
    notes: [],
    emit,
    ensureNotCancelled,
  };

  // 首帧立即返回内置计划，先于任何模型调用，保证首次进度反馈不受模型延迟影响。
  await store.updateTask(taskId, {
    status: 'running',
    startedAt,
    mode,
    progress: 0,
    planJson: JSON.stringify(defaultPlan()),
  });
  await emit('task.status', { status: 'running', mode, model, stage: 'planning', plan: defaultPlan() });

  let plan: TaskPlan = defaultPlan();
  const audit: Array<{ seq: number; actor: string; action: string; result: string; status: 'completed' | 'blocked' | 'pending'; at: number; model?: string }> = [];

  try {
    const planned = await withTimeout(
      planTask(config, prompt),
      stepTimeoutMs,
      () => new TaskTimeoutError('任务规划超时'),
    );
    plan = planned.value;
    if (planned.mode !== 'llm') mode = config ? 'degraded' : 'rule';
    if (planned.model) model = planned.model;
    if (planned.note) context.notes.push(planned.note);
    await store.updateTask(taskId, { planJson: JSON.stringify(plan), mode, model });
    await emit('task.status', { status: 'running', plan, mode, model, stage: 'planned', note: planned.note ?? null });

    for (const step of plan.steps) {
      await ensureNotCancelled();
      const tool = toolRegistry[step.tool];
      await emit('step.started', { index: step.index, tool: step.tool, title: step.title, intent: step.intent });
      await store.updateTask(taskId, { progress: Math.round(((step.index - 1) / plan.steps.length) * 100) });

      let attempt = 0;
      let lastError: unknown = null;
      let runResult: Awaited<ReturnType<typeof tool.run>> | null = null;
      while (attempt < maxAttempts && runResult === null) {
        attempt += 1;
        try {
          runResult = await withTimeout(
            tool.run(context),
            stepTimeoutMs,
            () => new TaskTimeoutError(`${step.title} 超出单步时间预算`),
          );
        } catch (error) {
          lastError = error;
          if (error instanceof TaskCancelledError || error instanceof TaskTimeoutError) {
            if (error instanceof TaskCancelledError) throw error;
            if (attempt >= maxAttempts) throw error;
          } else if (!isRetryable(error) || attempt >= maxAttempts) {
            throw error;
          }
          await emit('step.failed', {
            index: step.index,
            tool: step.tool,
            attempt,
            retrying: attempt < maxAttempts,
            error: error instanceof Error ? error.message : '未知错误',
          });
          await sleep(300 * attempt);
          await store.updateTask(taskId, { attempt });
        }
      }
      if (!runResult) throw lastError ?? new Error('INTERNAL');

      audit.push({
        seq: step.index,
        actor: step.tool,
        action: step.title,
        result: runResult.audit,
        status: runResult.status ?? 'completed',
        at: now(),
        ...(model ? { model } : {}),
      });
      await emit('step.completed', {
        index: step.index,
        tool: step.tool,
        title: step.title,
        audit: runResult.audit,
        status: runResult.status ?? 'completed',
        payload: runResult.payload,
      });
      if (step.tool === 'scenario.extract') {
        await store.updateTask(taskId, { scenarioJson: JSON.stringify(context.scenario) });
      }
      await store.updateTask(taskId, { progress: Math.round((step.index / plan.steps.length) * 100) });
    }

    if (!context.result) throw new Error('SIMULATION_FAILED');
    const result = context.result;
    context.summary = { ...context.summary!, simulationId: crypto.randomUUID() };
    const simulationId = context.summary.simulationId as string;
    const recommended = result.strategies.find((strategy) => strategy.id === result.recommended) ?? result.strategies[0];

    if (mode === 'llm' && (context.scenarioSource !== 'llm' || context.strategySource !== 'llm')) mode = 'degraded';
    if (context.notes.length && mode === 'llm') mode = 'degraded';

    const stepStates = buildStepStates(simulationId, result);
    const record = buildSimulationRecord({
      simulationId,
      taskId,
      result,
      audit,
      model,
      engineMs: context.summary.durationMs,
      reportMarkdown:
        (events.find(
          (event) => event.type === 'step.completed' && event.payload.tool === 'report.compose',
        )?.payload.payload as { reportMarkdown?: string } | undefined)?.reportMarkdown ?? null,
    });
    record.statesTruncated = stepStates.truncated;
    await store.saveSimulation(record);
    await store.saveStepStates(stepStates.records);
    await store.saveFindings(simulationId, result.findings);

    const skillName = `暴跌行情客户群体压力测试（${(Math.abs(result.scenario.marketShock) * 100).toFixed(0)}%）`;
    await store.proposeSkill({
      id: crypto.randomUUID(),
      name: skillName,
      version: 1,
      definitionJson: JSON.stringify({
        promptTemplate: prompt,
        plan,
        scenario: result.scenario,
        tools: plan.steps.map((step) => step.tool),
        strategyIds: result.strategies.map((strategy) => strategy.id),
      }),
      metricsJson: JSON.stringify({
        score: Number(recommended.score.toFixed(4)),
        peakPanic: Number(recommended.peakPanic.toFixed(4)),
        finalSell: Number(recommended.finalSell.toFixed(4)),
        finalChurn: Number(recommended.finalChurn.toFixed(4)),
        findings: result.findings.length,
        blockedFindings: result.findings.filter((finding) => finding.severity === '阻断').length,
        customerCount: result.customerCount,
        timeSteps: result.scenario.timeSteps,
        seed: result.seed,
        engineMs: context.summary.durationMs,
        ruleVersion: RULE_VERSION,
      }),
      sourceTaskId: taskId,
    });

    const resultJson = JSON.stringify({
      simulationId,
      summary: context.summary,
      plan,
      audit,
      notes: context.notes,
      mode,
      model,
    });
    await store.updateTask(taskId, {
      status: 'succeeded',
      mode,
      model,
      resultJson,
      simulationId,
      progress: 100,
      finishedAt: now(),
    });
    await emit('task.completed', {
      status: 'succeeded',
      mode,
      model,
      simulationId,
      summary: context.summary,
      notes: context.notes,
      durationMs: now() - startedAt,
    });

    return { status: 'succeeded', mode, errorCode: null, errorMessage: null, events, simulationId, summaryJson: resultJson };
  } catch (error) {
    const cancelled = error instanceof TaskCancelledError;
    const errorCode: TaskErrorCode = cancelled
      ? 'CANCELLED'
      : error instanceof TaskTimeoutError
        ? 'TASK_TIMEOUT'
        : errorCodeOf(error);
    const message = error instanceof Error ? error.message : '未知错误';
    await store.updateTask(taskId, {
      status: cancelled ? 'cancelled' : 'failed',
      errorCode,
      errorMessage: message,
      finishedAt: now(),
    });
    await emit(cancelled ? 'task.status' : 'task.failed', {
      status: cancelled ? 'cancelled' : 'failed',
      errorCode,
      errorMessage: message,
      notes: context.notes,
    });
    return { status: cancelled ? 'cancelled' : 'failed', mode, errorCode, errorMessage: message, events, simulationId: null, summaryJson: null };
  }
}
