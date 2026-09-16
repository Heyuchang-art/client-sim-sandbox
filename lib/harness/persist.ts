import { RULE_VERSION, type ComplianceFinding } from '../compliance';
import { aggregateSignature, type SimulationResult } from '../simulation';
import type { SimulationRecord, StepStateRecord } from './store';

export type AuditLike = {
  seq: number;
  actor: string;
  action: string;
  result: string;
  status: 'completed' | 'blocked' | 'pending';
  at: number;
  model?: string;
};

const rank = { 高: 3, 中: 2, 低: 1 } as Record<string, number>;

const priorityLabel = (value: unknown) => (typeof value === 'string' ? value : '低');

export function downsampleStates(states: Array<Record<string, unknown>>, limit: number) {
  if (states.length <= limit) return { states, truncated: false };
  const sorted = [...states].sort((a, b) => {
    const left = rank[priorityLabel(a.priority)] ?? 1;
    const right = rank[priorityLabel(b.priority)] ?? 1;
    if (right !== left) return right - left;
    return Number(b.panic ?? 0) - Number(a.panic ?? 0);
  });
  return { states: sorted.slice(0, limit), truncated: true };
}

export function buildStepStates(simulationId: string, result: SimulationResult) {
  const recommended = result.strategies.find((strategy) => strategy.id === result.recommended) ?? result.strategies[0];
  let truncated = false;
  const records: StepStateRecord[] = recommended.customerStates.map((states, index) => {
    const downsample = downsampleStates(states as unknown as Array<Record<string, unknown>>, 200);
    if (downsample.truncated) truncated = true;
    return {
      simulationId,
      strategyId: recommended.id,
      step: index + 1,
      statesJson: JSON.stringify(downsample.states),
    };
  });
  return { records, truncated, recommended };
}

export function buildSimulationRecord(input: {
  simulationId: string;
  taskId: string;
  result: SimulationResult;
  audit: AuditLike[];
  model: string | null;
  engineMs: number;
  reportMarkdown?: string | null;
}): SimulationRecord {
  const { simulationId, taskId, result, audit, model, engineMs, reportMarkdown } = input;
  return {
    id: simulationId,
    taskId,
    seed: result.seed,
    customerCount: result.customerCount,
    timeSteps: result.scenario.timeSteps,
    scenarioJson: JSON.stringify(result.scenario),
    scenarioMetaJson: JSON.stringify(result.scenarioMeta),
    recommendedStrategy: result.recommended,
    summaryJson: JSON.stringify({
      strategies: result.strategies.map(({ customerStates: _states, ...strategy }) => strategy),
      findings: result.findings,
      explanationFactors: result.explanationFactors,
      scenarioMeta: result.scenarioMeta,
      aggregateSignature: aggregateSignature(result),
      reportMarkdown: reportMarkdown ?? null,
    }),
    snapshotsJson: JSON.stringify(result.strategies.map((strategy) => ({ strategyId: strategy.id, snapshots: strategy.snapshots }))),
    auditJson: JSON.stringify(audit),
    findingsJson: JSON.stringify(result.findings),
    engineMs,
    statesTruncated: false,
    model,
    ruleVersion: RULE_VERSION,
  };
}

export type { ComplianceFinding };
