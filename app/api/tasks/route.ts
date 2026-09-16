import { ensureDatabase } from '../../../lib/db-runtime';
import { loadModelConfig } from '../../../lib/model/adapter';
import { createD1Store } from '../../../lib/harness/store';
import { runTask } from '../../../lib/harness/runner';
import { runInBackground } from '../../../lib/harness/scheduler';
import { readRuntimeEnv } from '../../../lib/harness/env';

export async function GET() {
  const db = await ensureDatabase();
  const { results } = await db.prepare(
    `SELECT id, prompt, status, mode, attempt, progress, simulation_id AS simulationId, error_code AS errorCode,
      model, created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt
     FROM tasks ORDER BY created_at DESC LIMIT 20`,
  ).all();
  return Response.json({ tasks: results });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { prompt?: string };
  const prompt = body.prompt?.trim();
  if (!prompt || prompt.length > 500) {
    return Response.json({ error: '任务描述须为 1—500 个字符。' }, { status: 400 });
  }

  await ensureDatabase();
  const store = await createD1Store();
  const config = loadModelConfig(await readRuntimeEnv());
  const taskId = crypto.randomUUID();
  await store.createTask({ id: taskId, prompt });

  const dispatch = await runInBackground(async () => {
    const backgroundStore = await createD1Store();
    await runTask({ store: backgroundStore, config, taskId, prompt });
  });

  return Response.json(
    { taskId, id: taskId, status: 'queued', mode: config ? 'llm' : 'rule', dispatch },
    { status: 202 },
  );
}
