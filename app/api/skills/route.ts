import { ensureDatabase } from '../../../lib/db-runtime';

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get('status');
  const db = await ensureDatabase();
  const statement = status
    ? db.prepare('SELECT id, name, version, status, definition_json AS definitionJson, metrics_json AS metricsJson, source_task_id AS sourceTaskId, created_at AS createdAt, decided_at AS decidedAt, decided_by AS decidedBy FROM skills WHERE status = ? ORDER BY created_at DESC LIMIT 50').bind(status)
    : db.prepare('SELECT id, name, version, status, definition_json AS definitionJson, metrics_json AS metricsJson, source_task_id AS sourceTaskId, created_at AS createdAt, decided_at AS decidedAt, decided_by AS decidedBy FROM skills ORDER BY created_at DESC LIMIT 50');
  const { results } = await statement.all<Record<string, unknown>>();
  const parse = (value: unknown) => {
    if (typeof value !== 'string' || !value) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  };
  return Response.json({
    skills: results.map((row) => ({
      ...row,
      definition: parse(row.definitionJson),
      metrics: parse(row.metricsJson),
      definitionJson: undefined,
      metricsJson: undefined,
    })),
  });
}
