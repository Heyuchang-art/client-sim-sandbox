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
  | 'report.compose'
  | 'metadata.tables'
  | 'metadata.describe'
  | 'metadata.metrics'
  | 'metadata.glossary'
  | 'analytics.ask';

export type HarnessEventType =
  | 'task.status'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'simulation.snapshot'
  | 'compliance.finding'
  | 'task.completed'
  | 'skill.reused'
  | 'skill.reuse_rejected'
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

/**
 * 规划来源：llm 为模型产出被采纳，rule 为内置模板，degraded 为模型调用失败回落，
 * skill 为直接采用已批准技能沉淀的编排。
 */
export type PlanSource = TaskMode | 'skill';

export type TaskPlan = {
  objective: string;
  steps: PlanStep[];
  source: PlanSource;
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
  /** 推荐策略的效用归因分解，供界面展示推荐理由。 */
  utility?: { avoidance: number; cost: number; wake: number; total: number };
  /** 本次生效的效用权重，随结果留痕。 */
  utilityWeights?: { avoid: number; cost: number; wake: number };
  /** 参数空间网格搜索结果；未开启搜索时为 null。 */
  strategySearch?: {
    evaluated: number;
    best: { levers: { reach: number; depth: number; personalize: number }; utility: { avoidance: number; cost: number; wake: number; total: number } } | null;
    top: Array<{ levers: { reach: number; depth: number; personalize: number }; utility: { avoidance: number; cost: number; wake: number; total: number } }>;
  } | null;
};
