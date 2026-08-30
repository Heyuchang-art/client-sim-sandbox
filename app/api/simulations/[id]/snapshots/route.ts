import { ensureDatabase } from '../../../../../lib/db-runtime';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await ensureDatabase();
  const run = await db.prepare('SELECT summary_json AS summaryJson FROM simulation_runs WHERE id = ?').bind(id).first<{ summaryJson: string }>();
  if (!run) return Response.json({ error: '未找到模拟。' }, { status: 404 });
  const summary = JSON.parse(run.summaryJson) as { strategies?: Array<{ id: string; snapshots: unknown[] }> };
  return Response.json({
    simulationId: id,
    snapshots: summary.strategies?.map((item) => ({ strategyId: item.id, snapshots: item.snapshots })) ?? [],
  });
}
