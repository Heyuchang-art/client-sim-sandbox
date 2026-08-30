import { ensureDatabase } from '../../../../../lib/db-runtime';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await ensureDatabase();
  const task = await db.prepare('SELECT id, status, created_at AS createdAt FROM tasks WHERE id = ?').bind(id).first();
  if (!task) return Response.json({ error: '未找到任务。' }, { status: 404 });
  const body = `event: task-status\ndata: ${JSON.stringify(task)}\n\n`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
