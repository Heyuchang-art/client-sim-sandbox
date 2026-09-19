import type { D1Like } from '../analytics/agent';
import { defaultScenario, parseScenarioPrompt, type ScenarioConfig } from '../scenario';
import { ModelUnavailableError, ModelTimeoutError, errorCodeOf, type ModelConfig } from '../model/adapter';
import { RULE_VERSION } from '../compliance';
import { defaultPlan, planTask } from './planner';
import { toolRegistry, type HarnessContext } from './tools';
import type { SkillProposal, TaskStore } from './store';
import { buildSimulationRecord, buildStepStates } from './persist';
import type { HarnessEvent, HarnessEventType, PlanStep, TaskErrorCode, TaskMode, TaskPlan, TaskStatus } from './types';

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
  /** 取数类工具需要的数据连接；推演流水线不依赖它 */
  db?: D1Like | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** 审计轨迹里显示的角色名：界面不出现 scenario.extract 这类内部工具 ID。 */
const auditActorLabels: Record<string, string> = {
  'scenario.extract': '任务规划',
  'customers.query': '客户筛选',
  'profile.build': '客户画像',
  'graph.build': '关系网络',
  'strategy.draft': '方案起草',
  'simulation.run': '群体推演',
  'compliance.review': '合规审查',
  'report.compose': '结果复盘',
};

/** 已批准技能的复用匹配：客群口径一致、且市场冲击接近（±5 个百分点）。 */
function skillDistance(skill: SkillProposal, scenario: ScenarioConfig) {
  try {
    const parsed = JSON.parse(skill.definitionJson) as { scenario?: ScenarioConfig };
    const saved = parsed.scenario;
    if (!saved || saved.targetSegment !== scenario.targetSegment) return null;
    const gap = Math.abs(Math.abs(saved.marketShock) - Math.abs(scenario.marketShock));
    return gap <= 0.05 ? gap : null;
  } catch {
    return null;
  }
}

async function findReusableSkill(store: TaskStore, scenario: ScenarioConfig): Promise<SkillProposal | null> {
  const approved = await store.listApprovedSkills();
  const ranked = approved
    .map((skill) => ({ skill, distance: skillDistance(skill, scenario) }))
    .filter((item): item is { skill: SkillProposal; distance: number } => item.distance !== null)
    .sort((left, right) => left.distance - right.distance);
  return ranked[0]?.skill ?? null;
}

/**
 * 取出技能里沉淀的编排。只有当保存的工具序列完整且每个工具都合法时才采用，
 * 否则回落到常规规划，避免一条损坏的技能记录把任务带进死路。
 */
/**
 * 取出技能里沉淀的编排。只有当保存的工具序列完整且每个工具都合法时才采用，
 * 否则回落到常规规划，避免一条损坏的技能记录把任务带进死路。
 *
 * 注意：技能沉淀的是「工作方法」（用哪些工具、什么顺序），不是界面文案。
 * 因此这里只采用工具序列，步骤名与说明一律取当前版本的规范定义，
 * 否则旧技能会把过期的界面文案带进新版本。
 */
function skillPlan(skill: SkillProposal): TaskPlan | null {
  try {
    const parsed = JSON.parse(skill.definitionJson) as { plan?: TaskPlan };
    const plan = parsed.plan;
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) return null;
    const canonical = new Map(defaultPlan().steps.map((step) => [step.tool, step]));
    const steps: PlanStep[] = [];
    for (const step of plan.steps) {
      const known = step && typeof step.tool === 'string' ? canonical.get(step.tool) : undefined;
      if (!known) return null;
      steps.push({ ...known, index: steps.length + 1 });
    }
    // 目标描述同样取当前版本的规范定义：技能只沉淀工具编排，不携带历史文案。
    return { objective: defaultPlan().objective, steps, source: 'skill' };
  } catch {
    return null;
  }
}

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
    db: options.db ?? null,
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
  let reusedSkill: SkillProposal | null = null;
  const audit: Array<{ seq: number; actor: string; action: string; result: string; status: 'completed' | 'blocked' | 'pending'; at: number; model?: string }> = [];

  try {
    // 已批准技能复用：规划之前先用规则解析做一次轻量场景预解析，
    // 命中同类场景时直接采用技能里沉淀的编排，而不是重新规划。
    reusedSkill = await findReusableSkill(store, parseScenarioPrompt(prompt).config);
    const adopted = reusedSkill ? skillPlan(reusedSkill) : null;
    if (reusedSkill && adopted) {
      plan = adopted;
      await emit('skill.reused', {
        id: reusedSkill.id,
        name: reusedSkill.name,
        version: reusedSkill.version,
        sourceTaskId: reusedSkill.sourceTaskId,
        tools: plan.steps.map((step) => step.tool),
      });
      context.notes.push(`采用已批准技能「${reusedSkill.name}」v${reusedSkill.version} 沉淀的编排。`);
    } else {
      reusedSkill = null;
    }

    if (plan.source !== 'skill') {
      // 说明：技能匹配用的是规划前的规则预解析场景，真实抽取完成后会在 scenario.extract 分支复核。
      // 该复核只能留痕、不能回退编排，前提是「不同技能沉淀的编排可能不同」；当前规划器的输出空间
      // 只有一个序列，所以预解析与真实抽取即使不一致，实际执行的步骤也完全相同，暂无实际影响。
      // 一旦放开 validatePlan 的工具序列约束，这里必须改为「复核通过后才采用编排」。
      const planned = await withTimeout(
        planTask(config, prompt),
        stepTimeoutMs,
        () => new TaskTimeoutError('任务规划超时'),
      );
      plan = planned.value;
      if (planned.mode !== 'llm') mode = config ? 'degraded' : 'rule';
      if (planned.model) model = planned.model;
      if (planned.note) context.notes.push(planned.note);
    }
    await store.updateTask(taskId, { planJson: JSON.stringify(plan), mode, model });
    await emit('task.status', {
      status: 'running',
      plan,
      mode,
      model,
      stage: 'planned',
      planSource: plan.source,
      note: reusedSkill ? `编排来自已批准技能「${reusedSkill.name}」v${reusedSkill.version}` : null,
    });

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
        // 界面显示业务角色名，内部工具 ID 通过悬停保留，便于追溯
        actor: auditActorLabels[step.tool] ?? step.tool,
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
        // 采纳技能用的是规则预解析出的场景，这里拿真实抽取结果复核一次。
        // 工具序列已经按技能执行、无法回退，因此不复用时要显式留痕，避免审计里出现
        // 「按 A 场景复用了技能，实际跑的是 B 场景」的隐性不一致。
        if (reusedSkill && skillDistance(reusedSkill, context.scenario) === null) {
          await emit('skill.reuse_rejected', {
            id: reusedSkill.id,
            name: reusedSkill.name,
            version: reusedSkill.version,
            reason: '真实抽取出的场景与技能记录的客群口径或冲击幅度不匹配',
            extractedScenario: context.scenario,
          });
          context.notes.push(
            `技能「${reusedSkill.name}」v${reusedSkill.version} 的编排已按预解析场景采用，但真实抽取结果不匹配，已记录该差异供人工核对。`,
          );

        }
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
    // 同名技能按已存在版本递增，否则回滚接口永远找不到更早的版本。
    const skillVersion = await store.nextSkillVersion(skillName);
    await store.proposeSkill({
      id: crypto.randomUUID(),
      name: skillName,
      version: skillVersion,
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
