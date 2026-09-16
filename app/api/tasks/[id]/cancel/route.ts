import { ensureDatabase } from '../../../../../lib/db-runtime';

/**
 * 协作式取消：写入 cancel_requested，执行器在步骤边界停止任务。
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await ensureDatabase();
  const task = await db.prepare('SELECT status FROM tasks WHERE id = ?').bind(id).first<{ status: string }>();
  if (!task) return Response.json({ error: '未找到任务。' }, { status: 404 });
  if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') {
    return Response.json({ id, status: task.status, cancelled: false, reason: '任务已结束，无需取消。' });
  }
  await db.prepare('UPDATE tasks SET status = ? WHERE id = ?').bind('cancel_requested', id).run();
  return Response.json({ id, status: 'cancel_requested', cancelled: true });
}
