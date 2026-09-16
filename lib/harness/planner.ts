import { coerceScenarioConfig, parseScenarioPrompt, segmentCriteria, type ScenarioConfig } from '../scenario';
import { chatJson, type ModelConfig } from '../model/adapter';
import { allAblationsOff, strategyDefinitions, type StrategyId } from '../simulation';
import type { PlanStep, StrategyDraft, TaskMode, TaskPlan, ToolName } from './types';

export type Planned<T> = {
  value: T;
  mode: TaskMode;
  model: string | null;
  note?: string;
};

const canonicalSteps: Array<{ tool: ToolName; title: string; intent: string }> = [
  { tool: 'scenario.extract', title: '解析业务目标与场景参数', intent: '把自然语言目标收敛为可追踪的结构化场景配置' },
  { tool: 'customers.query', title: '筛选目标客户', intent: '按客群口径筛选候选客户并记录排除原因' },
  { tool: 'profile.build', title: '构建行为画像与记忆', intent: '聚合心理参数与历史服务记忆，形成结构化证据' },
  { tool: 'graph.build', title: '构建客户关系网络', intent: '生成相似性、社交影响与统一服务三类关系边' },
  { tool: 'strategy.draft', title: '生成候选沟通策略', intent: '产出宏观策略草稿与一人一策话术' },
  { tool: 'simulation.run', title: '执行群体行为模拟', intent: '按确定性数值模型推演逐时间步的群体状态' },
  { tool: 'compliance.review', title: '合规硬边界审查', intent: '规则引擎扫描草稿并阻断高风险表达' },
  { tool: 'report.compose', title: '输出报告与反思', intent: '生成可审计结论并沉淀候选技能' },
];

export function defaultPlan(): TaskPlan {
  return {
    objective: '完成暴跌行情下的客户群体压力测试并输出可审计的沟通策略建议。',
    steps: canonicalSteps.map((step, index) => ({ index: index + 1, ...step })),
    source: 'rule',
  };
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

const planSystem = `你是券商客户经营领域的任务规划助手。请把用户目标拆解为结构化执行步骤。
只返回 JSON：{"objective": string, "steps": [{"tool": string, "title": string, "intent": string}]}
约束：
1. tool 只能取以下值之一：scenario.extract, customers.query, profile.build, graph.build, strategy.draft, simulation.run, compliance.review, report.compose；
2. 必须按上述顺序覆盖全部 8 个工具，不得增删；
3. title 不超过 20 字，intent 不超过 40 字；
4. objective 不超过 60 字，只描述业务目标，不要包含数字承诺或投资建议。`;

function validatePlan(value: unknown): TaskPlan | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { objective?: unknown; steps?: unknown };
  const objective = cleanText(record.objective, 60);
  if (!objective || !Array.isArray(record.steps)) return null;
  const provided = new Map<string, { title: string; intent: string }>();
  record.steps.forEach((step) => {
    if (typeof step !== 'object' || step === null) return;
    const item = step as { tool?: unknown; title?: unknown; intent?: unknown };
    const tool = typeof item.tool === 'string' ? item.tool : '';
    if (!canonicalSteps.some((canonical) => canonical.tool === tool)) return;
    const title = cleanText(item.title, 20);
    const intent = cleanText(item.intent, 40);
    if (title && intent) provided.set(tool, { title, intent });
  });
  if (provided.size < canonicalSteps.length) return null;
  return {
    objective,
    steps: canonicalSteps.map((canonical, index) => ({
      index: index + 1,
      tool: canonical.tool,
      ...provided.get(canonical.tool)!,
    })),
    source: 'llm',
  };
}

export async function planTask(config: ModelConfig | null, prompt: string): Promise<Planned<TaskPlan>> {
  if (!config) return { value: defaultPlan(), mode: 'rule', model: null, note: '未配置模型密钥，使用内置规划模板。' };
  try {
    const result = await chatJson<TaskPlan>({
      config,
      system: planSystem,
      user: `用户目标：${prompt}`,
      validate: validatePlan,
      maxOutputTokens: 700,
    });
    return { value: result.data, mode: 'llm', model: result.model };
  } catch (error) {
    return {
      value: defaultPlan(),
      mode: 'degraded',
      model: config.model,
      note: `任务规划降级为内置模板：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

const scenarioSystem = `你是券商压力测试的场景参数抽取器。把用户目标转换为结构化场景配置。
只返回 JSON：{"marketShock": number, "durationHours": number, "customerCount": number, "timeSteps": number, "seed": number, "targetSegment": "high_volatility_drawdown" | "all_customers"}
约束：
1. marketShock 用小数表示跌幅，下跌 10% 写作 -0.1，绝对值范围 0.01—0.5；
2. durationHours 为 1—168 的整数，可把“3 天”换算为 72；
3. customerCount 为 50—1000 的整数；
4. timeSteps 为 5—20 的整数；
5. seed 为 1—2147483647 的整数，用户未指定时返回 20260830；
6. 只有用户明确提到“全部客户/不筛选”时才返回 all_customers，否则返回 high_volatility_drawdown；
7. 不要输出任何解释文字。`;

export async function extractScenarioWithModel(
  config: ModelConfig | null,
  prompt: string,
): Promise<Planned<ScenarioConfig & { defaultedFields: string[]; notes: string[] }>> {
  const fallback = parseScenarioPrompt(prompt);
  if (!config) {
    return {
      value: { ...fallback.config, defaultedFields: fallback.defaultedFields, notes: fallback.notes },
      mode: 'rule',
      model: null,
      note: '未配置模型密钥，使用规则抽取。',
    };
  }
  try {
    const result = await chatJson<ScenarioConfig & { defaultedFields: string[]; notes: string[] }>({
      config,
      system: scenarioSystem,
      user: `用户目标：${prompt}`,
      validate: (value) => {
        if (typeof value !== 'object' || value === null) return null;
        const parsed = coerceScenarioConfig(value as Record<string, unknown>, fallback.config);
        // 模型必须给出市场跌幅与持续时间，否则视为结构不合格并回落到规则抽取。
        if (parsed.defaultedFields.includes('marketShock') || parsed.defaultedFields.includes('durationHours')) return null;
        return { ...parsed.config, defaultedFields: parsed.defaultedFields, notes: parsed.notes };
      },
      maxOutputTokens: 400,
    });
    return { value: result.data, mode: 'llm', model: result.model };
  } catch (error) {
    return {
      value: { ...fallback.config, defaultedFields: fallback.defaultedFields, notes: fallback.notes },
      mode: 'degraded',
      model: config.model,
      note: `场景抽取降级为规则路径：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

const strategySystem = `你是券商客户沟通策略生成器。针对给定的市场冲击场景，为三套固定策略分别撰写一句话说明与一段待审查的草稿文案。
只返回 JSON：{"strategies": [{"id": "baseline"|"broadcast"|"segmented", "description": string, "draftText": string}]}
约束：
1. 三套策略 id 必须齐全且各出现一次；
2. description 不超过 40 字，描述该策略的处置方式；
3. draftText 不超过 120 字，是准备发送给客户的统一文案草稿，需要体现该策略的风格；
4. 不要输出解释文字。`;

const strategyIds: StrategyId[] = ['baseline', 'broadcast', 'segmented'];

export async function draftStrategiesWithModel(
  config: ModelConfig | null,
  scenario: ScenarioConfig,
  riskContext: string,
): Promise<Planned<StrategyDraft[]>> {
  const fallback: StrategyDraft[] = strategyDefinitions.map((definition) => ({
    id: definition.id,
    description: definition.description,
    draftText: definition.draftText,
  }));
  if (!config) return { value: fallback, mode: 'rule', model: null, note: '未配置模型密钥，使用内置策略模板。' };
  try {
    const result = await chatJson<StrategyDraft[]>({
      config,
      system: strategySystem,
      user: `场景：市场下跌 ${(Math.abs(scenario.marketShock) * 100).toFixed(0)}%，持续 ${scenario.durationHours} 小时，目标客群：${segmentCriteria(scenario.targetSegment)}。风险上下文：${riskContext}`,
      validate: (value) => {
        if (typeof value !== 'object' || value === null) return null;
        const list = (value as { strategies?: unknown }).strategies;
        if (!Array.isArray(list)) return null;
        const drafts = new Map<string, StrategyDraft>();
        list.forEach((item) => {
          if (typeof item !== 'object' || item === null) return;
          const record = item as { id?: unknown; description?: unknown; draftText?: unknown };
          const id = typeof record.id === 'string' ? record.id : '';
          if (!strategyIds.includes(id as StrategyId)) return;
          const description = cleanText(record.description, 40);
          const draftText = cleanText(record.draftText, 120);
          if (!description || !draftText) return;
          drafts.set(id, { id, description, draftText });
        });
        if (drafts.size !== strategyIds.length) return null;
        return strategyIds.map((id) => drafts.get(id)!);
      },
      maxOutputTokens: 800,
    });
    return { value: result.data, mode: 'llm', model: result.model };
  } catch (error) {
    return {
      value: fallback,
      mode: 'degraded',
      model: config.model,
      note: `策略生成降级为内置模板：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

export const ablationDefaults = allAblationsOff;
export const planSteps: PlanStep[] = canonicalSteps.map((step, index) => ({ index: index + 1, ...step }));
