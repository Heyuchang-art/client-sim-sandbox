import { ensureDatabase } from '../../../lib/db-runtime';

export async function GET() {
  const db = await ensureDatabase();
  const row = await db.prepare('SELECT COUNT(*) AS count FROM tasks').first<{ count: number }>();
  return Response.json({ status: 'ok', service: 'ClientSim Harness', persistedTasks: row?.count ?? 0 });
}
