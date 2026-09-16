import { ensureDatabase } from '../../../../lib/db-runtime';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await ensureDatabase();
  const run = await db.prepare(
    `SELECT id, task_id AS taskId, seed, customer_count AS customerCount, time_steps AS timeSteps,
      recommended_strategy AS recommendedStrategy, scenario_json AS scenarioJson, scenario_meta_json AS scenarioMetaJson,
      summary_json AS summaryJson, snapshots_json AS snapshotsJson, audit_json AS auditJson, findings_json AS findingsJson,
      engine_ms AS engineMs, states_truncated AS statesTruncated, model, rule_version AS ruleVersion, created_at AS createdAt
    FROM simulation_runs WHERE id = ?`,
  ).bind(id).first<Record<string, unknown>>();
  if (!run) return Response.json({ error: '未找到模拟。' }, { status: 404 });
  const parse = (value: unknown, fallback: unknown) => {
    if (typeof value !== 'string' || !value) return fallback;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return fallback;
    }
  };
  return Response.json({
    id: run.id,
    taskId: run.taskId,
    seed: run.seed,
    customerCount: run.customerCount,
    timeSteps: run.timeSteps,
    recommendedStrategy: run.recommendedStrategy,
    engineMs: run.engineMs,
    statesTruncated: Boolean(run.statesTruncated),
    model: run.model,
    ruleVersion: run.ruleVersion,
    createdAt: run.createdAt,
    scenario: parse(run.scenarioJson, null),
    scenarioMeta: parse(run.scenarioMetaJson, null),
    summary: parse(run.summaryJson, null),
    snapshots: parse(run.snapshotsJson, []),
    audit: parse(run.auditJson, []),
    findings: parse(run.findingsJson, []),
  });
}
