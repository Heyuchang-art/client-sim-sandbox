import type { ComplianceFinding } from '../compliance';

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'cancel_requested';
export type TaskMode = 'llm' | 'rule' | 'degraded';

export type TaskErrorCode =
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_TIMEOUT'
  | 'MODEL_FORMAT'
  | 'KNOWLEDGE_MISSING'
  | 'SIMULATION_FAILED'
  | 'TASK_TIMEOUT'
  | 'CANCELLED'
  | 'INTERNAL';

export type ToolName =
  | 'scenario.extract'
  | 'customers.query'
  | 'profile.build'
  | 'graph.build'
  | 'strategy.draft'
  | 'simulation.run'
  | 'compliance.review'
  | 'report.compose';

export type HarnessEventType =
  | 'task.status'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'simulation.snapshot'
  | 'compliance.finding'
  | 'task.completed'
  | 'task.failed'
  | 'heartbeat';

export type HarnessEvent = {
  seq: number;
  type: HarnessEventType;
  at: number;
  payload: Record<string, unknown>;
};

export type PlanStep = {
  index: number;
  tool: ToolName;
  title: string;
  intent: string;
};

export type TaskPlan = {
  objective: string;
  steps: PlanStep[];
  source: TaskMode;
};

export type StrategyDraft = {
  id: string;
  name?: string;
  description?: string;
  draftText?: string;
};

export type MemorySummary = {
  archetype: string;
  behavior: string;
  preference: string;
  evidence: string[];
};

export type TaskSummary = {
  simulationId: string | null;
  recommended: string;
  score: number;
  customerCount: number;
  findings: number;
  blockedFindings: number;
  peakPanic: number;
  finalSell: number;
  finalChurn: number;
  ruleVersion: string;
  aggregateSignature: string;
  durationMs: number;
  complianceFindings: ComplianceFinding[];
};
