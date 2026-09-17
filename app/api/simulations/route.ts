import { ensureDatabase } from '../../../lib/db-runtime';
import { defaultScenario, type ScenarioConfig } from '../../../lib/scenario';
import { runSimulation } from '../../../lib/simulation';
import { createD1Store } from '../../../lib/harness/store';
import { buildSimulationRecord, buildStepStates } from '../../../lib/harness/persist';

/**
 * 同步模拟接口：保留给调试、基准测试与本地降级路径使用。
 * 生产级任务请使用 POST /api/tasks 的异步链路。
 */
export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ScenarioConfig> & { taskId?: string; ablations?: Record<string, boolean> };
  const customerCount = Math.min(1000, Math.max(50, body.customerCount ?? 300));
  const timeSteps = Math.min(20, Math.max(5, body.timeSteps ?? 10));
  const seed = Math.trunc(body.seed ?? 20260830);
  const scenario: ScenarioConfig = {
    ...defaultScenario,
    marketShock: -Math.min(0.5, Math.max(0.01, Math.abs(body.marketShock ?? defaultScenario.marketShock))),
    durationHours: Math.min(168, Math.max(1, Math.round(body.durationHours ?? defaultScenario.durationHours))),
    customerCount,
    timeSteps,
    seed,
    targetSegment: body.targetSegment === 'all_customers' ? 'all_customers' : 'high_volatility_drawdown',
  };
  const startedAt = Date.now();
  const result = runSimulation(scenario, { ablations: body.ablations, searchSpace: true });
  const engineMs = Date.now() - startedAt;
  const simulationId = crypto.randomUUID();
  // 同步调试路径：引擎本身不产生时间戳（保持确定性），这里也不再为每一步补一个相同的
  // Date.now()——那会让 8 条审计记录显示成同一个时刻，看起来像真实时间戳其实是伪造的。
  // 逐步时间戳只由异步任务执行器记录；同步路径按事件序列留痕，界面显示为「序列」。
  const audit = result.audit;

  const db = await ensureDatabase();
  const taskId = body.taskId ?? null;
  const record = buildSimulationRecord({ simulationId, taskId: taskId ?? simulationId, result, audit, model: null, engineMs });
  const stepStates = buildStepStates(simulationId, result);
  record.statesTruncated = stepStates.truncated;
  if (!taskId) {
    await db
      .prepare('INSERT INTO tasks (id, prompt, status, mode, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(simulationId, '同步调试模拟', 'succeeded', 'rule', Date.now())
      .run();
  }

  const store = await createD1Store();
  await store.saveSimulation(record);
  await store.saveStepStates(stepStates.records);
  await store.saveFindings(simulationId, result.findings);

  return Response.json({ id: simulationId, engineMs, ...result }, { status: 201 });
}
