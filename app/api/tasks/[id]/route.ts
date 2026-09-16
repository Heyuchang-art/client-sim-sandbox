import { ensureDatabase } from '../../../../lib/db-runtime';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await ensureDatabase();
  const task = await db.prepare(
    `SELECT id, prompt, status, mode, attempt, progress, plan_json AS planJson, scenario_json AS scenarioJson,
      result_json AS resultJson, simulation_id AS simulationId, error_code AS errorCode, error_message AS errorMessage,
      model, created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt
     FROM tasks WHERE id = ?`,
  ).bind(id).first<Record<string, unknown>>();
  if (!task) return Response.json({ error: '未找到任务。' }, { status: 404 });
  const parse = (value: unknown) => {
    if (typeof value !== 'string' || !value) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  };
  return Response.json({
    ...task,
    plan: parse(task.planJson),
    scenario: parse(task.scenarioJson),
    result: parse(task.resultJson),
    planJson: undefined,
    scenarioJson: undefined,
    resultJson: undefined,
  });
}
