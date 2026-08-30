import { env } from 'cloudflare:workers';

export async function ensureDatabase() {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, prompt TEXT NOT NULL, status TEXT NOT NULL,
      result_json TEXT, created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS simulation_runs (
      id TEXT PRIMARY KEY, task_id TEXT, seed INTEGER NOT NULL,
      customer_count INTEGER NOT NULL, time_steps INTEGER NOT NULL,
      recommended_strategy TEXT NOT NULL, summary_json TEXT NOT NULL,
      created_at INTEGER NOT NULL, FOREIGN KEY(task_id) REFERENCES tasks(id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY, task_id TEXT, actor TEXT NOT NULL,
      action TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id)
    )`),
  ]);
  return env.DB;
}
