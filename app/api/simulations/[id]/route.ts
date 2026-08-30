import { ensureDatabase } from '../../../../lib/db-runtime';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await ensureDatabase();
  const run = await db.prepare(
    `SELECT id, task_id AS taskId, seed, customer_count AS customerCount,
      time_steps AS timeSteps, recommended_strategy AS recommendedStrategy,
      summary_json AS summaryJson, created_at AS createdAt
    FROM simulation_runs WHERE id = ?`,
  ).bind(id).first<Record<string, unknown>>();
  if (!run) return Response.json({ error: '未找到模拟。' }, { status: 404 });
  return Response.json({ ...run, summary: JSON.parse(String(run.summaryJson)) });
}
