import { ensureDatabase } from '../db-runtime';
import type { ComplianceFinding } from '../compliance';
import type { HarnessEvent, HarnessEventType, TaskMode, TaskStatus } from './types';

export type TaskRecordRow = {
  id: string;
  prompt: string;
  status: TaskStatus;
  mode: TaskMode;
  attempt: number;
};

export type TaskPatch = {
  status?: TaskStatus;
  mode?: TaskMode;
  attempt?: number;
  progress?: number;
  planJson?: string;
  scenarioJson?: string;
  resultJson?: string;
  simulationId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  model?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
};

export type SimulationRecord = {
  id: string;
  taskId: string;
  seed: number;
  customerCount: number;
  timeSteps: number;
  scenarioJson: string;
  scenarioMetaJson: string;
  recommendedStrategy: string;
  summaryJson: string;
  snapshotsJson: string;
  auditJson: string;
  findingsJson: string;
  engineMs: number;
  statesTruncated: boolean;
  model: string | null;
  ruleVersion: string;
};

export type StepStateRecord = {
  simulationId: string;
  strategyId: string;
  step: number;
  statesJson: string;
};

export type SkillProposal = {
  id: string;
  name: string;
  version: number;
  definitionJson: string;
  metricsJson: string;
  sourceTaskId: string;
};

export type TaskStore = {
  createTask: (input: { id: string; prompt: string }) => Promise<void>;
  getTask: (id: string) => Promise<TaskRecordRow | null>;
  updateTask: (id: string, patch: TaskPatch) => Promise<void>;
  appendEvent: (event: HarnessEvent & { taskId: string }) => Promise<void>;
  getEvents: (taskId: string, afterSeq: number) => Promise<HarnessEvent[]>;
  saveSimulation: (record: SimulationRecord) => Promise<void>;
  saveStepStates: (records: StepStateRecord[]) => Promise<void>;
  saveFindings: (simulationId: string, findings: ComplianceFinding[]) => Promise<void>;
  proposeSkill: (proposal: SkillProposal) => Promise<void>;
};

export async function createD1Store(): Promise<TaskStore> {
  const db = await ensureDatabase();
  return {
    async createTask({ id, prompt }) {
      await db
        .prepare('INSERT INTO tasks (id, prompt, status, mode, attempt, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, prompt, 'queued', 'rule', 0, Date.now())
        .run();
    },
    async getTask(id) {
      const row = await db
        .prepare('SELECT id, prompt, status, mode, attempt FROM tasks WHERE id = ?')
        .bind(id)
        .first<TaskRecordRow>();
      return row ?? null;
    },
    async updateTask(id, patch) {
      const assignments: string[] = [];
      const values: unknown[] = [];
      const map: Record<keyof TaskPatch, string> = {
        status: 'status',
        mode: 'mode',
        attempt: 'attempt',
        progress: 'progress',
        planJson: 'plan_json',
        scenarioJson: 'scenario_json',
        resultJson: 'result_json',
        simulationId: 'simulation_id',
        errorCode: 'error_code',
        errorMessage: 'error_message',
        model: 'model',
        startedAt: 'started_at',
        finishedAt: 'finished_at',
      };
      (Object.keys(patch) as Array<keyof TaskPatch>).forEach((key) => {
        assignments.push(`${map[key]} = ?`);
        values.push(patch[key] ?? null);
      });
      if (!assignments.length) return;
      await db
        .prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?`)
        .bind(...values, id)
        .run();
    },
    async appendEvent(event) {
      await db
        .prepare('INSERT INTO task_events (id, task_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), event.taskId, event.seq, event.type, JSON.stringify(event.payload), event.at)
        .run();
    },
    async getEvents(taskId, afterSeq) {
      const { results } = await db
        .prepare('SELECT seq, type, payload_json AS payloadJson, created_at AS at FROM task_events WHERE task_id = ? AND seq > ? ORDER BY seq ASC LIMIT 200')
        .bind(taskId, afterSeq)
        .all<{ seq: number; type: HarnessEventType; payloadJson: string; at: number }>();
      return results.map((row) => ({
        seq: row.seq,
        type: row.type,
        at: row.at,
        payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
      }));
    },
    async saveSimulation(record) {
      await db
        .prepare(
          `INSERT INTO simulation_runs
            (id, task_id, seed, customer_count, time_steps, scenario_json, scenario_meta_json, recommended_strategy,
             summary_json, snapshots_json, audit_json, findings_json, engine_ms, states_truncated, model, rule_version, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.id,
          record.taskId,
          record.seed,
          record.customerCount,
          record.timeSteps,
          record.scenarioJson,
          record.scenarioMetaJson,
          record.recommendedStrategy,
          record.summaryJson,
          record.snapshotsJson,
          record.auditJson,
          record.findingsJson,
          record.engineMs,
          record.statesTruncated ? 1 : 0,
          record.model,
          record.ruleVersion,
          Date.now(),
        )
        .run();
    },
    async saveStepStates(records) {
      if (!records.length) return;
      const statements = records.map((record) =>
        db
          .prepare('INSERT INTO simulation_step_states (id, simulation_id, strategy_id, step, states_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), record.simulationId, record.strategyId, record.step, record.statesJson, Date.now()),
      );
      const chunkSize = 40;
      for (let index = 0; index < statements.length; index += chunkSize) {
        await db.batch(statements.slice(index, index + chunkSize));
      }
    },
    async saveFindings(simulationId, findings) {
      if (!findings.length) return;
      const statements = findings.map((finding) =>
        db
          .prepare(
            `INSERT INTO compliance_findings
              (id, simulation_id, rule, title, severity, status, strategy, evidence, detail, rule_version, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            simulationId,
            finding.rule,
            finding.title,
            finding.severity,
            finding.status,
            finding.strategy,
            finding.evidence,
            finding.detail,
            finding.ruleVersion,
            Date.now(),
          ),
      );
      const chunkSize = 40;
      for (let index = 0; index < statements.length; index += chunkSize) {
        await db.batch(statements.slice(index, index + chunkSize));
      }
    },
    async proposeSkill(proposal) {
      await db
        .prepare(
          `INSERT INTO skills (id, name, version, status, definition_json, metrics_json, source_task_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          proposal.id,
          proposal.name,
          proposal.version,
          'candidate',
          proposal.definitionJson,
          proposal.metricsJson,
          proposal.sourceTaskId,
          Date.now(),
        )
        .run();
    },
  };
}
