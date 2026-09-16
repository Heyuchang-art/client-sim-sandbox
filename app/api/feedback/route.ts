import { ensureDatabase } from '../../../lib/db-runtime';

export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get('taskId');
  const db = await ensureDatabase();
  const statement = taskId
    ? db.prepare('SELECT id, task_id AS taskId, rating, labels_json AS labelsJson, comment, created_by AS createdBy, created_at AS createdAt FROM feedback WHERE task_id = ? ORDER BY created_at DESC LIMIT 50').bind(taskId)
    : db.prepare('SELECT id, task_id AS taskId, rating, labels_json AS labelsJson, comment, created_by AS createdBy, created_at AS createdAt FROM feedback ORDER BY created_at DESC LIMIT 50');
  const { results } = await statement.all<Record<string, unknown>>();
  return Response.json({
    feedback: results.map((row) => ({
      ...row,
      labels: typeof row.labelsJson === 'string' ? (JSON.parse(row.labelsJson) as unknown) : [],
      labelsJson: undefined,
    })),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { taskId?: string; rating?: number; labels?: string[]; comment?: string; createdBy?: string };
  const taskId = body.taskId?.trim();
  const rating = Number(body.rating);
  if (!taskId) return Response.json({ error: '缺少 taskId。' }, { status: 400 });
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return Response.json({ error: '评分须为 1—5。' }, { status: 400 });
  }
  const db = await ensureDatabase();
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO feedback (id, task_id, rating, labels_json, comment, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, taskId, Math.round(rating), JSON.stringify(body.labels ?? []), body.comment?.slice(0, 500) ?? null, body.createdBy?.slice(0, 60) ?? 'analyst_demo', Date.now())
    .run();
  return Response.json({ id, taskId, rating: Math.round(rating) }, { status: 201 });
}
