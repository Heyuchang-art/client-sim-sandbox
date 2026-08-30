import { ensureDatabase } from '../../../lib/db-runtime';

type TaskPayload = { prompt?: string; result?: unknown };

export async function GET() {
  const db = await ensureDatabase();
  const { results } = await db.prepare(
    'SELECT id, prompt, status, result_json AS resultJson, created_at AS createdAt FROM tasks ORDER BY created_at DESC LIMIT 20',
  ).all();
  return Response.json({ tasks: results });
}

export async function POST(request: Request) {
  const body = (await request.json()) as TaskPayload;
  const prompt = body.prompt?.trim();
  if (!prompt || prompt.length > 500) {
    return Response.json({ error: '任务描述须为 1—500 个字符。' }, { status: 400 });
  }

  const db = await ensureDatabase();
  const taskId = crypto.randomUUID();
  const now = Date.now();
  const resultJson = JSON.stringify(body.result ?? null);
  await db.batch([
    db.prepare('INSERT INTO tasks (id, prompt, status, result_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(taskId, prompt, 'completed', resultJson, now),
    db.prepare('INSERT INTO audit_events (id, task_id, actor, action, result, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), taskId, 'analyst_demo', 'task.completed', 'deterministic-simulation', now),
  ]);

  return Response.json({ id: taskId, status: 'completed', createdAt: now }, { status: 201 });
}
