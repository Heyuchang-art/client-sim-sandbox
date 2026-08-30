import { ensureDatabase } from '../../../../lib/db-runtime';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await ensureDatabase();
  const task = await db.prepare(
    'SELECT id, prompt, status, result_json AS resultJson, created_at AS createdAt FROM tasks WHERE id = ?',
  ).bind(id).first<Record<string, unknown>>();
  if (!task) return Response.json({ error: '未找到报告。' }, { status: 404 });
  return Response.json({ report: task, disclaimer: '本报告基于合成数据，仅用于策略压力测试，不构成投资建议。' });
}
