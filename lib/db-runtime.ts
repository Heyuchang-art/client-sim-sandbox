import { env } from 'cloudflare:workers';

async function ensureColumns(table: string, columns: Array<[string, string]>) {
  const existing = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const names = new Set(existing.results.map((column) => column.name));
  for (const [name, definition] of columns) {
    if (names.has(name)) continue;
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
  }
}

/**
 * 幂等的本地/远端建表逻辑：新增能力只做 CREATE TABLE IF NOT EXISTS 与列补齐，
 * 保证旧库升级后既有数据与接口保持兼容。
 */
export async function ensureDatabase() {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, prompt TEXT NOT NULL, status TEXT NOT NULL,
      result_json TEXT, created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS simulation_runs (
      id TEXT PRIMARY KEY, task_id TEXT, seed INTEGER NOT NULL,
      customer_count INTEGER NOT NULL, time_steps INTEGER NOT NULL,
      scenario_json TEXT NOT NULL DEFAULT '{}',
      recommended_strategy TEXT NOT NULL, summary_json TEXT NOT NULL,
      created_at INTEGER NOT NULL, FOREIGN KEY(task_id) REFERENCES tasks(id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY, task_id TEXT, actor TEXT NOT NULL,
      action TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, seq INTEGER NOT NULL,
      type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS simulation_step_states (
      id TEXT PRIMARY KEY, simulation_id TEXT NOT NULL, strategy_id TEXT NOT NULL,
      step INTEGER NOT NULL, states_json TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS compliance_findings (
      id TEXT PRIMARY KEY, simulation_id TEXT NOT NULL, rule TEXT NOT NULL, title TEXT NOT NULL,
      severity TEXT NOT NULL, status TEXT NOT NULL, strategy TEXT NOT NULL, evidence TEXT,
      detail TEXT NOT NULL, rule_version TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
      definition_json TEXT NOT NULL, metrics_json TEXT NOT NULL, source_task_id TEXT,
      created_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, rating INTEGER NOT NULL, labels_json TEXT,
      comment TEXT, created_by TEXT, created_at INTEGER NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS task_events_lookup ON task_events (task_id, seq)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS step_states_lookup ON simulation_step_states (simulation_id, strategy_id, step)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS findings_lookup ON compliance_findings (simulation_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS skills_lookup ON skills (name, version)'),
  ]);

  await ensureColumns('tasks', [
    ['mode', "TEXT NOT NULL DEFAULT 'rule'"],
    ['attempt', 'INTEGER NOT NULL DEFAULT 0'],
    ['progress', 'INTEGER NOT NULL DEFAULT 0'],
    ['plan_json', 'TEXT'],
    ['scenario_json', 'TEXT'],
    ['simulation_id', 'TEXT'],
    ['error_code', 'TEXT'],
    ['error_message', 'TEXT'],
    ['model', 'TEXT'],
    ['started_at', 'INTEGER'],
    ['finished_at', 'INTEGER'],
  ]);

  await ensureColumns('simulation_runs', [
    ['scenario_meta_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['snapshots_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['audit_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['findings_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['engine_ms', 'INTEGER NOT NULL DEFAULT 0'],
    ['states_truncated', 'INTEGER NOT NULL DEFAULT 0'],
    ['model', 'TEXT'],
    ['rule_version', "TEXT NOT NULL DEFAULT ''"],
  ]);

  return env.DB;
}
