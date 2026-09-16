import { ensureDatabase } from '../../../../../lib/db-runtime';

/**
 * 逐时间步的客户状态，用于沙盘回放与审计还原。
 * 客户数超过 200 时按风险优先级降采样，并在 statesTruncated 中显式标注。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const step = Number(url.searchParams.get('step') ?? 0);
  const db = await ensureDatabase();
  const query = step > 0
    ? db.prepare('SELECT step, strategy_id AS strategyId, states_json AS statesJson FROM simulation_step_states WHERE simulation_id = ? AND step = ? ORDER BY strategy_id').bind(id, step)
    : db.prepare('SELECT step, strategy_id AS strategyId, states_json AS statesJson FROM simulation_step_states WHERE simulation_id = ? ORDER BY step, strategy_id').bind(id);
  const { results } = await query.all<{ step: number; strategyId: string; statesJson: string }>();
  if (!results.length) return Response.json({ error: '未找到该模拟的时间步状态。' }, { status: 404 });
  return Response.json({
    simulationId: id,
    steps: results.map((row) => ({ step: row.step, strategyId: row.strategyId, states: JSON.parse(row.statesJson) })),
  });
}
