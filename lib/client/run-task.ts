import { coerceScenarioConfig, defaultScenario, type ScenarioConfig } from '../scenario';
import { aggregateSignature, runSimulation, type SimulationResult } from '../simulation';
import type { ComplianceFinding } from '../compliance';
import type { PlanStep, StrategyDraft, TaskErrorCode, TaskMode } from '../harness/types';

export type HarnessStepState = {
  index: number;
  tool: string;
  title: string;
  intent: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  audit?: string;
};

export type RunSnapshot = {
  step: number;
  stepHours: number;
  panic: number;
  sell: number;
  churn: number;
  trust: number;
};

export type RunState = {
  phase: 'idle' | 'submitting' | 'streaming' | 'finished' | 'failed';
  taskId: string | null;
  mode: TaskMode | 'local';
  model: string | null;
  objective: string | null;
  steps: HarnessStepState[];
  progress: number;
  snapshots: RunSnapshot[];
  findings: ComplianceFinding[];
  notes: string[];
  defaultedFields: string[];
  errorCode: string | null;
  errorMessage: string | null;
  firstFeedbackMs: number | null;
  durationMs: number | null;
};

export type RunOutcome = {
  state: RunState;
  scenario: ScenarioConfig;
  strategyDrafts: StrategyDraft[];
  result: SimulationResult;
  /** 服务端聚合签名与本地重算签名是否一致，用于验证确定性。 */
  deterministicMatch: boolean | null;
  serverSignature: string | null;
  simulationId: string | null;
  audit: Array<{ seq: number; actor: string; action: string; result: string; status: string; at: number; model?: string }>;
  source: 'server' | 'local';
};

export const emptyRunState: RunState = {
  phase: 'idle',
  taskId: null,
  mode: 'rule',
  model: null,
  objective: null,
  steps: [],
  progress: 0,
  snapshots: [],
  findings: [],
  notes: [],
  defaultedFields: [],
  errorCode: null,
  errorMessage: null,
  firstFeedbackMs: null,
  durationMs: null,
};

type StepCompletedPayload = {
  index: number;
  tool: string;
  audit: string;
  status: string;
  payload?: Record<string, unknown>;
};

const sseEventTypes = [
  'task.status',
  'step.started',
  'step.completed',
  'step.failed',
  'simulation.snapshot',
  'compliance.finding',
  'task.completed',
  'task.failed',
  'heartbeat',
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 启动服务端任务并订阅真实 SSE 事件流。
 * 任何环节失败都会抛出，由调用方决定是否走同版本确定性本地降级。
 */
export async function startServerTask(
  prompt: string,
  onState: (state: RunState) => void,
): Promise<Omit<RunOutcome, 'result' | 'deterministicMatch'>> {
  const startedAt = Date.now();
  const response = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!response.ok) throw new Error(`task-submit-failed:${response.status}`);
  const submitted = (await response.json()) as { taskId: string; mode?: TaskMode };
  const taskId = submitted.taskId;

  let state: RunState = {
    ...emptyRunState,
    phase: 'streaming',
    taskId,
    mode: submitted.mode ?? 'rule',
  };
  const push = () => onState({ ...state, steps: [...state.steps], snapshots: [...state.snapshots], findings: [...state.findings] });
  push();

  let scenario: ScenarioConfig | null = null;
  let strategyDrafts: StrategyDraft[] = [];
  let serverSignature: string | null = null;
  let audit: RunOutcome['audit'] = [];
  let simulationId: string | null = null;
  let mode: TaskMode | 'local' = state.mode;

  const terminal = await new Promise<{ status: string; errorCode: string | null; errorMessage: string | null }>((resolve) => {
    const source = new EventSource(`/api/tasks/${taskId}/events`);
    let settled = false;
    const finish = (value: { status: string; errorCode: string | null; errorMessage: string | null }) => {
      if (settled) return;
      settled = true;
      source.close();
      resolve(value);
    };

    const markStep = (index: number, patch: Partial<HarnessStepState>) => {
      state = {
        ...state,
        steps: state.steps.map((step) => (step.index === index ? { ...step, ...patch } : step)),
      };
    };

    sseEventTypes.forEach((type) => {
      source.addEventListener(type, (raw) => {
        const event = JSON.parse((raw as MessageEvent).data) as { seq: number; at: number; payload: Record<string, unknown> };
        if (state.firstFeedbackMs === null) state = { ...state, firstFeedbackMs: Date.now() - startedAt };
        const payload = event.payload;

        if (type === 'task.status') {
          mode = (payload.mode as TaskMode) ?? mode;
          if (typeof payload.model === 'string') state = { ...state, model: payload.model as string };
          if (typeof payload.note === 'string' && payload.note) state = { ...state, notes: [...state.notes, payload.note as string] };
          if (typeof payload.objective === 'string') state = { ...state, objective: payload.objective as string };
          const plan = payload.plan as { objective?: string; steps?: PlanStep[] } | undefined;
          if (plan?.steps) {
            state = {
              ...state,
              objective: plan.objective ?? state.objective,
              steps: plan.steps.map((step) => {
                const existing = state.steps.find((item) => item.index === step.index);
                return {
                  index: step.index,
                  tool: step.tool,
                  title: step.title,
                  intent: step.intent,
                  status: existing?.status ?? 'pending',
                  audit: existing?.audit,
                };
              }),
            };
          }
        }

        if (type === 'step.started') {
          const index = Number(payload.index);
          markStep(index, { index, tool: String(payload.tool), title: String(payload.title), intent: String(payload.intent), status: 'running' });
          state = { ...state, progress: Math.max(state.progress, Math.round(((index - 1) / Math.max(1, state.steps.length)) * 100)) };
        }

        if (type === 'step.completed') {
          const detail = payload as unknown as StepCompletedPayload;
          markStep(detail.index, { status: detail.status === 'blocked' ? 'blocked' : 'completed', audit: detail.audit });
          const inner = detail.payload ?? {};
          if (detail.tool === 'scenario.extract' && inner.scenario) {
            const coerced = coerceScenarioConfig(inner.scenario as Record<string, unknown>, defaultScenario);
            scenario = coerced.config;
            state = {
              ...state,
              defaultedFields: Array.isArray(inner.defaultedFields) ? (inner.defaultedFields as string[]) : [],
              notes: Array.isArray(inner.notes) ? [...state.notes, ...(inner.notes as string[])] : state.notes,
            };
          }
          if (detail.tool === 'strategy.draft' && Array.isArray(inner.drafts)) {
            strategyDrafts = inner.drafts as StrategyDraft[];
          }
        }

        if (type === 'step.failed') {
          markStep(Number(payload.index), { status: 'failed' });
          const errorText = typeof payload.error === 'string' ? payload.error : '';
          state = { ...state, notes: [...state.notes, `步骤重试：${errorText}`] };
        }

        if (type === 'simulation.snapshot') {
          state = {
            ...state,
            snapshots: [
              ...state.snapshots,
              {
                step: Number(payload.step),
                stepHours: Number(payload.stepHours),
                panic: Number(payload.panic),
                sell: Number(payload.sell),
                churn: Number(payload.churn),
                trust: Number(payload.trust),
              },
            ],
          };
        }

        if (type === 'compliance.finding') {
          state = { ...state, findings: [...state.findings, payload as unknown as ComplianceFinding] };
        }

        if (type === 'task.completed') {
          simulationId = typeof payload.simulationId === 'string' ? payload.simulationId : null;
          const notes = Array.isArray(payload.notes) ? (payload.notes as string[]) : [];
          state = {
            ...state,
            phase: 'finished',
            mode: (payload.mode as TaskMode) ?? mode,
            model: typeof payload.model === 'string' ? payload.model : state.model,
            notes: [...state.notes, ...notes],
            progress: 100,
          };
          finish({ status: 'succeeded', errorCode: null, errorMessage: null });
        }

        if (type === 'task.failed' || (type === 'task.status' && payload.status === 'cancelled')) {
          state = {
            ...state,
            phase: 'failed',
            errorCode: typeof payload.errorCode === 'string' ? payload.errorCode : 'INTERNAL',
            errorMessage: typeof payload.errorMessage === 'string' ? payload.errorMessage : null,
          };
          finish({
            status: typeof payload.status === 'string' ? payload.status : 'failed',
            errorCode: state.errorCode,
            errorMessage: state.errorMessage,
          });
        }

        push();
      });
    });

    source.onerror = () => finish({ status: 'stream-error', errorCode: null, errorMessage: null });
  });

  // 事件流结束后取回任务最终结果，补齐审计与场景参数。
  let resolvedScenario: ScenarioConfig | null = scenario;
  let detailStatus: string | null = null;
  let pollAttempt = 0;
  const pollDeadline = startedAt + 60000;
  while (detailStatus === null && pollAttempt < 150 && Date.now() < pollDeadline) {
    pollAttempt += 1;
    const detailResponse = await fetch(`/api/tasks/${taskId}`);
    if (detailResponse.ok) {
      const detail = (await detailResponse.json()) as {
        status?: string;
        scenario?: ScenarioConfig | null;
        plan?: { objective?: string; steps?: PlanStep[] } | null;
        simulationId?: string | null;
        result?: {
          summary?: { aggregateSignature?: string } | null;
          audit?: RunOutcome['audit'];
          notes?: string[];
          mode?: TaskMode;
          model?: string | null;
        } | null;
        errorCode?: string | null;
        errorMessage?: string | null;
      };
      if (detail.scenario) resolvedScenario = coerceScenarioConfig(detail.scenario as unknown as Record<string, unknown>, defaultScenario).config;
      if (detail.plan?.steps && state.steps.length === 0) {
        state = {
          ...state,
          objective: detail.plan.objective ?? state.objective,
          steps: detail.plan.steps.map((step) => ({ ...step, status: 'completed' as const })),
        };
      }
      if (detail.simulationId) simulationId = detail.simulationId;
      if (detail.result?.summary?.aggregateSignature) serverSignature = detail.result.summary.aggregateSignature;
      if (Array.isArray(detail.result?.audit)) audit = detail.result.audit;
      if (Array.isArray(detail.result?.notes)) state = { ...state, notes: [...state.notes, ...detail.result.notes] };
      if (detail.result?.mode) state = { ...state, mode: detail.result.mode, model: detail.result.model ?? state.model };
      if (detail.errorCode && !state.errorCode) state = { ...state, errorCode: detail.errorCode, errorMessage: detail.errorMessage ?? null };
      if (detail.status === 'succeeded' || detail.status === 'failed' || detail.status === 'cancelled') {
        detailStatus = detail.status;
        break;
      }
    }
    await sleep(400);
  }

  const finalStatus = detailStatus ?? terminal.status;
  if (finalStatus !== 'succeeded') throw new Error(terminal.errorCode ?? finalStatus);
  if (!resolvedScenario) throw new Error(`scenario-missing:${finalStatus}`);

  state = { ...state, phase: 'finished', durationMs: Date.now() - startedAt, taskId };
  push();

  return {
    state,
    scenario: resolvedScenario,
    strategyDrafts,
    serverSignature,
    simulationId,
    audit,
    source: 'server',
  };
}

export type Degradation = { code: TaskErrorCode; label: string; note: string };

/**
 * 把服务端任务失败映射为界面可见的降级说明：
 * 任何失败都必须显式标注并给出确定性降级路径，不得静默忽略。
 */
export function degradationOf(error: unknown): Degradation {
  const message = error instanceof Error ? error.message : String(error);
  const upper = message.toUpperCase();
  const pick = (code: TaskErrorCode, label: string): Degradation => ({
    code,
    label,
    note:
      code === 'CANCELLED'
        ? '任务已按人工请求取消，已展示同版本确定性引擎的对照结果。'
        : '服务端任务失败（' + label + '），已使用同版本确定性引擎完成本地降级。',
  });
  if (upper.includes('CANCEL')) return pick('CANCELLED', '任务已取消');
  if (upper.includes('MODEL_TIMEOUT') || message.includes('超时')) return pick('MODEL_TIMEOUT', '模型调用超时');
  if (upper.includes('MODEL_FORMAT') || upper.includes('SCENARIO-MISSING')) return pick('MODEL_FORMAT', '模型输出格式错误');
  if (upper.includes('KNOWLEDGE_MISSING')) return pick('KNOWLEDGE_MISSING', '知识库缺失');
  if (upper.includes('SIMULATION_FAILED')) return pick('SIMULATION_FAILED', '数值模拟失败');
  if (upper.includes('TASK_TIMEOUT')) return pick('TASK_TIMEOUT', '任务超出时间预算');
  if (
    upper.includes('MODEL_UNAVAILABLE') ||
    upper.includes('TASK-SUBMIT-FAILED') ||
    upper.includes('STREAM-ERROR') ||
    upper.includes('FAILED TO FETCH')
  ) {
    return pick('MODEL_UNAVAILABLE', '任务服务或模型不可用');
  }
  return pick('INTERNAL', '内部错误');
}

export function localOutcome(
  scenario: ScenarioConfig,
  strategyDrafts: StrategyDraft[],
  reason: string,
  previous: RunState,
): RunOutcome {
  const result = runSimulation(scenario, { strategyDrafts });
  const state: RunState = {
    ...previous,
    phase: 'finished',
    mode: 'local',
    notes: [reason],
    progress: 100,
    errorCode: null,
    errorMessage: null,
    durationMs: null,
  };
  return {
    state,
    scenario,
    strategyDrafts,
    result,
    deterministicMatch: null,
    serverSignature: null,
    simulationId: null,
    audit: result.audit.map((entry) => ({ ...entry, at: entry.at ?? Date.now() })),
    source: 'local',
  };
}

export function completeOutcome(
  base: Omit<RunOutcome, 'result' | 'deterministicMatch'>,
  strategyDrafts: StrategyDraft[],
): RunOutcome {
  const result = runSimulation(base.scenario, { strategyDrafts });
  const localSignature = aggregateSignature(result);
  return {
    ...base,
    result,
    deterministicMatch: base.serverSignature ? base.serverSignature === localSignature : null,
  };
}

export function cancelServerTask(taskId: string) {
  return fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST' }).catch(() => undefined);
}
