import { ensureDatabase } from '../../../../../lib/db-runtime';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await ensureDatabase();
  const run = await db
    .prepare('SELECT snapshots_json AS snapshotsJson, scenario_meta_json AS scenarioMetaJson, states_truncated AS statesTruncated FROM simulation_runs WHERE id = ?')
    .bind(id)
    .first<{ snapshotsJson: string; scenarioMetaJson: string; statesTruncated: number }>();
  if (!run) return Response.json({ error: '未找到模拟。' }, { status: 404 });
  return Response.json({
    simulationId: id,
    snapshots: JSON.parse(run.snapshotsJson),
    scenarioMeta: JSON.parse(run.scenarioMetaJson),
    statesTruncated: Boolean(run.statesTruncated),
  });
}
