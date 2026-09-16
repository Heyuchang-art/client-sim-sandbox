import { bm25Search, type RetrievedDoc } from './rag';
import {
  aggregateSignature,
  runSimulation,
  strategyDefinitions,
  type AblationFlags,
  type StrategyId,
} from '../simulation';
import type { ScenarioConfig } from '../scenario';

export type ComparisonMode = 'llm-only' | 'llm-rag' | 'single-agent' | 'dual-layer';

export type ComparisonOutcome = {
  mode: ComparisonMode;
  label: string;
  /** 该模式实际使用的信息来源：模型草稿或内置规则近似。 */
  source: 'llm' | 'rule';
  ranking: StrategyId[];
  recommended: StrategyId;
  rankAgreement: number;
  stability: number;
  latencyMs: number;
  peakPanic: number | null;
  finalSell: number | null;
  finalChurn: number | null;
  engineMs: number | null;
  retrieved: string[];
  note: string;
};

const modeLabels: Record<ComparisonMode, string> = {
  'llm-only': '仅模型（无模拟）',
  'llm-rag': '模型 + 知识检索（无模拟）',
  'single-agent': '单智能体（无个体状态与传播）',
  'dual-layer': '双层模拟（本方案）',
};

/** 各策略文本线索：用于在“不做数值模拟”的对照模式下给出可复现的排序。 */
const strategyHints: Record<StrategyId, string[]> = {
  baseline: ['不主动', '观察', '被动'],
  broadcast: ['统一', '风险提示', '普适'],
  segmented: ['分群', '差异化', '一人一策', '个性化'],
};

const knowledgeKeywords = ['风险等级', '适当性', '风险提示', '可复现', '边界', '审计', '投诉', '流失', '量化依据'];

function textScore(strategyId: StrategyId, retrieved: RetrievedDoc[]) {
  const definition = strategyDefinitions.find((item) => item.id === strategyId);
  const text = definition ? definition.name + ' ' + definition.description + ' ' + (definition.draftText ?? '') : '';
  const hints = strategyHints[strategyId];
  const hintCoverage = hints.filter((hint) => text.includes(hint)).length / Math.max(1, hints.length);
  const retrievedText = retrieved.map((doc) => doc.text).join(' ');
  const knowledgeCoverage = knowledgeKeywords.filter((keyword) => retrievedText.includes(keyword) && text.includes(keyword)).length
    / Math.max(1, knowledgeKeywords.length);
  return Number((hintCoverage + knowledgeCoverage).toFixed(4));
}

function rankingFromScores(scores: Array<{ id: StrategyId; score: number }>): StrategyId[] {
  return [...scores].sort((left, right) => right.score - left.score).map((item) => item.id);
}

/** 肯德尔一致性：两个排序在共同元素上的同序对占比。 */
export function rankAgreement(left: StrategyId[], right: StrategyId[]) {
  const shared = left.filter((id) => right.includes(id));
  if (shared.length < 2) return 0;
  let concordant = 0;
  let total = 0;
  for (let i = 0; i < shared.length; i += 1) {
    for (let j = i + 1; j < shared.length; j += 1) {
      total += 1;
      const leftOrder = left.indexOf(shared[i]) - left.indexOf(shared[j]);
      const rightOrder = right.indexOf(shared[i]) - right.indexOf(shared[j]);
      if (leftOrder === 0 || rightOrder === 0) continue;
      if (Math.sign(leftOrder) === Math.sign(rightOrder)) concordant += 1;
    }
  }
  return total === 0 ? 0 : Number((concordant / total).toFixed(4));
}

function stabilityOf(signatures: string[]) {
  if (signatures.length === 0) return 0;
  const unique = new Set(signatures);
  return Number((1 / unique.size).toFixed(4));
}

export type ComparisonOptions = {
  repeats?: number;
  query?: string;
  ablations?: AblationFlags;
};

/**
 * 四种对照模式比较。
 * 无模型密钥时，文本类模式使用内置规则近似（source = 'rule'），
 * 该事实必须与结果一同记录，不得在材料中表述为真实模型表现。
 */
export function compareModes(scenario: ScenarioConfig, options: ComparisonOptions = {}) {
  const { repeats = 3, query = '暴跌行情 客户沟通 适当性 风险揭示' } = options;
  const retrieved = bm25Search(query, 3);
  const outcomes: ComparisonOutcome[] = [];

  const textModes: ComparisonMode[] = ['llm-only', 'llm-rag'];
  for (const mode of textModes) {
    const startedAt = Date.now();
    const knowledge = mode === 'llm-rag' ? retrieved : [];
    const scores = strategyDefinitions.map((definition) => ({ id: definition.id, score: textScore(definition.id, knowledge) }));
    const ranking = rankingFromScores(scores);
    const latencyMs = Date.now() - startedAt;
    outcomes.push({
      mode,
      label: modeLabels[mode],
      source: 'rule',
      ranking,
      recommended: ranking[0],
      rankAgreement: 0,
      stability: stabilityOf(Array.from({ length: repeats }, () => ranking.join('>'))),
      latencyMs,
      peakPanic: null,
      finalSell: null,
      finalChurn: null,
      engineMs: null,
      retrieved: knowledge.map((doc) => doc.id),
      note: mode === 'llm-rag'
        ? '无模型密钥时按内置规则近似：以检索到的投教/合规语料覆盖度修正策略排序。'
        : '无模型密钥时按内置规则近似：仅依据策略文本线索排序，不运行数值模拟。',
    });
  }

  const engineRuns: Array<{ mode: ComparisonMode; ablation: AblationFlags; note: string }> = [
    { mode: 'single-agent', ablation: { disablePsychology: true, disableContagion: true, disableMemory: true }, note: '单一全局智能体：关闭心理层、传播层与记忆层。' },
    { mode: 'dual-layer', ablation: options.ablations ?? {}, note: '完整双层模拟：心理层 + 传播层 + 记忆层 + 合规层。' },
  ];

  for (const run of engineRuns) {
    const startedAt = Date.now();
    const signatures: string[] = [];
    let result = runSimulation(scenario, { ablations: run.ablation });
    for (let index = 0; index < repeats; index += 1) {
      const replay = runSimulation(scenario, { ablations: run.ablation });
      signatures.push(aggregateSignature(replay));
      if (index === 0) result = replay;
    }
    const latencyMs = Date.now() - startedAt;
    const ranking = rankingFromScores(result.strategies.map((strategy) => ({ id: strategy.id, score: strategy.score })));
    const recommended = result.strategies.find((strategy) => strategy.id === result.recommended) ?? result.strategies[0];
    outcomes.push({
      mode: run.mode,
      label: modeLabels[run.mode],
      source: 'rule',
      ranking,
      recommended: recommended.id,
      rankAgreement: 0,
      stability: stabilityOf(signatures),
      latencyMs,
      peakPanic: Number(recommended.peakPanic.toFixed(4)),
      finalSell: Number(recommended.finalSell.toFixed(4)),
      finalChurn: Number(recommended.finalChurn.toFixed(4)),
      engineMs: result.durationMs,
      retrieved: [],
      note: run.note,
    });
  }

  const reference = outcomes.find((item) => item.mode === 'dual-layer')!;
  for (const outcome of outcomes) {
    outcome.rankAgreement = outcome.mode === 'dual-layer' ? 1 : rankAgreement(outcome.ranking, reference.ranking);
  }

  return { retrieved, outcomes };
}
