import { ensureDatabase } from '../../../lib/db-runtime';
import { defaultScenario, type ScenarioConfig } from '../../../lib/scenario';
import { runSimulation } from '../../../lib/simulation';

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ScenarioConfig> & { taskId?: string };
  const customerCount = Math.min(1000, Math.max(50, body.customerCount ?? 300));
  const timeSteps = Math.min(20, Math.max(5, body.timeSteps ?? 10));
  const seed = Math.trunc(body.seed ?? 20260830);
  const scenario: ScenarioConfig = {
    ...defaultScenario,
    marketShock: -Math.min(0.5, Math.max(0.01, Math.abs(body.marketShock ?? defaultScenario.marketShock))),
    durationHours: Math.min(168, Math.max(1, Math.round(body.durationHours ?? defaultScenario.durationHours))),
    customerCount,
    timeSteps,
    seed,
    targetSegment: 'high_volatility_drawdown',
  };
  const result = runSimulation(scenario);
  const persistedStrategies = result.strategies.map(({ customerStates: _customerStates, ...strategy }) => strategy);
  const id = crypto.randomUUID();
  const db = await ensureDatabase();
  await db.prepare(
    `INSERT INTO simulation_runs
      (id, task_id, seed, customer_count, time_steps, scenario_json, recommended_strategy, summary_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    body.taskId ?? null,
    seed,
    customerCount,
    timeSteps,
    JSON.stringify(scenario),
    result.recommended,
    JSON.stringify({ strategies: persistedStrategies, findings: result.findings, explanationFactors: result.explanationFactors }),
    Date.now(),
  ).run();
  return Response.json({ id, ...result }, { status: 201 });
}
