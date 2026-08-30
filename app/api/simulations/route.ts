import { ensureDatabase } from '../../../lib/db-runtime';
import { runSimulation } from '../../../lib/simulation';

export async function POST(request: Request) {
  const body = (await request.json()) as { customerCount?: number; timeSteps?: number; seed?: number; taskId?: string };
  const customerCount = Math.min(1000, Math.max(50, body.customerCount ?? 300));
  const timeSteps = Math.min(20, Math.max(5, body.timeSteps ?? 10));
  const seed = Math.trunc(body.seed ?? 20260830);
  const result = runSimulation(customerCount, timeSteps, seed);
  const id = crypto.randomUUID();
  const db = await ensureDatabase();
  await db.prepare(
    `INSERT INTO simulation_runs
      (id, task_id, seed, customer_count, time_steps, recommended_strategy, summary_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    body.taskId ?? null,
    seed,
    customerCount,
    timeSteps,
    result.recommended,
    JSON.stringify({ strategies: result.strategies, findings: result.findings }),
    Date.now(),
  ).run();
  return Response.json({ id, ...result }, { status: 201 });
}
