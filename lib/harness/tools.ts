import type { ComplianceFinding } from '../compliance';
import { RULE_VERSION } from '../compliance';
import type { ModelConfig } from '../model/adapter';
import { scenarioLabel, stepHours, segmentCriteria, type ScenarioConfig } from '../scenario';
import {
  aggregateSignature,
  buildCustomerPool,
  generateRelationships,
  runSimulation,
  strategyDefinitions,
  type CustomerPool,
  type RelationshipEdge,
  type SimulationResult,
} from '../simulation';
import { buildMemorySummaries } from './memory';
import { draftStrategiesWithModel, extractScenarioWithModel } from './planner';
import type {
  HarnessEventType,
  MemorySummary,
  StrategyDraft,
  TaskMode,
  TaskSummary,
  ToolName,
} from './types';

export type HarnessContext = {
  taskId: string;
  prompt: string;
  config: ModelConfig | null;
  scenario: ScenarioConfig;
  scenarioDefaulted: string[];
  scenarioNotes: string[];
  scenarioSource: TaskMode;
  model: string | null;
  pool: CustomerPool | null;
  relationships: RelationshipEdge[];
  memory: MemorySummary[];
  strategyDrafts: StrategyDraft[];
  strategySource: TaskMode;
  result: SimulationResult | null;
  findings: ComplianceFinding[];
  summary: TaskSummary | null;
  notes: string[];
  emit: (type: HarnessEventType, payload: Record<string, unknown>) => Promise<void>;
  ensureNotCancelled: () => Promise<void>;
};

export type ToolRunResult = {
  audit: string;
  payload: Record<string, unknown>;
  status?: 'completed' | 'pending' | 'blocked';
};

export type HarnessTool = {
  name: ToolName;
  title: string;
  intent: string;
  run: (context: HarnessContext) => Promise<ToolRunResult>;
};

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function archetypeStats(customers: CustomerPool['customers']) {
  const groups = new Map<string, CustomerPool['customers']>();
  customers.forEach((customer) => {
    const group = groups.get(customer.archetype) ?? [];
    group.push(customer);
    groups.set(customer.archetype, group);
  });
  return [...groups.entries()].map(([archetype, group]) => ({
    archetype,
    count: group.length,
    riskLevel: group[0].riskLevel,
    损失厌恶: Number(average(group.map((item) => item.psychology.lossAversion)).toFixed(3)),
    从众敏感: Number(average(group.map((item) => item.psychology.herding)).toFixed(3)),
    收益追求: Number(average(group.map((item) => item.psychology.ambition)).toFixed(3)),
    投资纪律: Number(average(group.map((item) => item.psychology.discipline)).toFixed(3)),
    长期耐心: Number(average(group.map((item) => item.psychology.patience)).toFixed(3)),
    机构信任: Number(average(group.map((item) => item.psychology.trust)).toFixed(3)),
  }));
}

export const toolRegistry: Record<ToolName, HarnessTool> = {
  'scenario.extract': {
    name: 'scenario.extract',
    title: '解析业务目标与场景参数',
    intent: '把自然语言目标收敛为可追踪的结构化场景配置',
    async run(context) {
      const planned = await extractScenarioWithModel(context.config, context.prompt);
      const { defaultedFields, notes, ...scenario } = planned.value;
      context.scenario = scenario;
      context.scenarioDefaulted = defaultedFields;
      context.scenarioNotes = notes;
      context.scenarioSource = planned.mode;
      if (planned.model) context.model = planned.model;
      if (planned.note) context.notes.push(planned.note);
      return {
        audit: `${scenarioLabel(scenario)}，每段 ${stepHours(scenario).toFixed(1)} 小时，随机种子 ${scenario.seed}`,
        payload: {
          scenario,
          defaultedFields,
          notes,
          source: planned.mode,
          note: planned.note ?? null,
          model: planned.model,
        },
        status: defaultedFields.length ? 'pending' : 'completed',
      };
    },
  },
  'customers.query': {
    name: 'customers.query',
    title: '筛选目标客户',
    intent: '按客群口径筛选候选客户并记录排除原因',
    async run(context) {
      const pool = buildCustomerPool(context.scenario);
      context.pool = pool;
      return {
        audit: `从 ${pool.generatedCustomers} 名候选客户中筛出 ${pool.matchedCustomers} 名符合条件的，本次选取 ${pool.customers.length} 名`,
        payload: {
          generatedCustomers: pool.generatedCustomers,
          matchedCustomers: pool.matchedCustomers,
          selectedCustomers: pool.customers.length,
          excludedCustomers: pool.excludedCustomers,
          segmentRelaxed: pool.segmentRelaxed,
          segmentCriteria: segmentCriteria(context.scenario.targetSegment),
        },
        status: pool.segmentRelaxed ? 'pending' : 'completed',
      };
    },
  },
  'profile.build': {
    name: 'profile.build',
    title: '构建行为画像与记忆',
    intent: '聚合心理参数与历史服务记忆，形成结构化证据',
    async run(context) {
      const customers = context.pool?.customers ?? [];
      context.memory = buildMemorySummaries(customers);
      const stats = archetypeStats(customers);
      return {
        audit: `${stats.length} 类客户画像、6 项心理特征，平均持仓回撤 ${average(customers.map((item) => item.drawdown)).toFixed(1)}%`,
        payload: { archetypes: stats, memory: context.memory },
      };
    },
  },
  'graph.build': {
    name: 'graph.build',
    title: '构建客户关系网络',
    intent: '生成相似性、社交影响与统一服务三类关系边',
    async run(context) {
      const customers = context.pool?.customers ?? [];
      const relationships = generateRelationships(customers, context.scenario.seed);
      context.relationships = relationships;
      const byType = relationships.reduce<Record<string, number>>((accumulator, edge) => {
        accumulator[edge.type] = (accumulator[edge.type] ?? 0) + 1;
        return accumulator;
      }, {});
      return {
        audit: `${relationships.length} 条客户关联（兴趣相近 ${byType.similarity ?? 0}、互相影响 ${byType.social ?? 0}、同一服务覆盖 ${byType.service ?? 0}）`,
        payload: { total: relationships.length, byType },
      };
    },
  },
  'strategy.draft': {
    name: 'strategy.draft',
    title: '生成候选沟通策略',
    intent: '产出宏观策略草稿与一人一策话术',
    async run(context) {
      const customers = context.pool?.customers ?? [];
      const highRisk = customers
        .filter((customer) => customer.panic > 0.5)
        .slice(0, 40)
        .map((customer) => `${customer.archetype}(恐慌 ${(customer.panic * 100).toFixed(0)}%)`);
      const riskContext = [
        `目标客群：${segmentCriteria(context.scenario.targetSegment)}`,
        `高恐慌样本：${highRisk.slice(0, 5).join('、') || '暂无'}`,
        `情绪均值：恐慌 ${(average(customers.map((item) => item.panic)) * 100).toFixed(0)}%、机构信任 ${(average(customers.map((item) => item.psychology.trust)) * 100).toFixed(0)}%`,
      ].join('；');
      const planned = await draftStrategiesWithModel(context.config, context.scenario, riskContext);
      context.strategyDrafts = planned.value;
      context.strategySource = planned.mode;
      if (planned.model) context.model = planned.model;
      if (planned.note) context.notes.push(planned.note);
      return {
        audit: `${planned.value.length} 套候选方案（${planned.mode === 'llm' ? '模型生成' : planned.mode === 'degraded' ? '模型降级' : '内置模板'}），话术草稿已提交合规检查`,
        payload: { drafts: planned.value, source: planned.mode, note: planned.note ?? null, model: planned.model },
      };
    },
  },
  'simulation.run': {
    name: 'simulation.run',
    title: '执行群体行为模拟',
    intent: '按确定性数值模型推演逐时间步的群体状态',
    async run(context) {
      const startedAt = Date.now();
      const result = runSimulation(context.scenario, { strategyDrafts: context.strategyDrafts, searchSpace: true });
      context.result = result;
      const recommended = result.strategies.find((strategy) => strategy.id === result.recommended) ?? result.strategies[0];
      for (const snapshot of recommended.snapshots) {
        await context.ensureNotCancelled();
        await context.emit('simulation.snapshot', {
          strategyId: recommended.id,
          step: snapshot.step,
          stepHours: snapshot.stepHours,
          panic: Number(snapshot.panic.toFixed(4)),
          sell: Number(snapshot.sell.toFixed(4)),
          churn: Number(snapshot.churn.toFixed(4)),
          trust: Number(snapshot.trust.toFixed(4)),
        });
      }
      context.summary = {
        simulationId: null,
        recommended: recommended.name,
        score: Number(recommended.score.toFixed(4)),
        customerCount: result.customerCount,
        findings: result.findings.length,
        blockedFindings: result.findings.filter((finding) => finding.severity === '阻断').length,
        peakPanic: Number(recommended.peakPanic.toFixed(4)),
        finalSell: Number(recommended.finalSell.toFixed(4)),
        finalChurn: Number(recommended.finalChurn.toFixed(4)),
        ruleVersion: result.scenarioMeta.ruleVersion,
        aggregateSignature: aggregateSignature(result),
        durationMs: Date.now() - startedAt,
        complianceFindings: result.findings,
        utility: recommended.utility,
        utilityWeights: result.utilityWeights,
        strategySearch: result.strategySearch,
      };
      return {
        audit: `分 ${result.scenario.timeSteps} 段推演、${result.customerCount} 名客户，计算耗时 ${context.summary.durationMs} 毫秒；推荐「${recommended.name}」（相对不主动沟通：风险改善 ${(recommended.utility.avoidance * 100).toFixed(2)}，人力成本与打扰代价见执行记录第 8 步）`,
        payload: {
          recommended: recommended.id,
          engineMs: context.summary.durationMs,
          strategies: result.strategies.map((strategy) => ({
            id: strategy.id,
            name: strategy.name,
            score: Number(strategy.score.toFixed(4)),
            utility: strategy.utility,
            peakPanic: Number(strategy.peakPanic.toFixed(4)),
            finalSell: Number(strategy.finalSell.toFixed(4)),
            complianceRisk: strategy.complianceRisk,
          })),
        },
      };
    },
  },
  'compliance.review': {
    name: 'compliance.review',
    title: '合规硬边界审查',
    intent: '规则引擎扫描草稿并阻断高风险表达',
    async run(context) {
      const findings = context.result?.findings ?? [];
      context.findings = findings;
      for (const finding of findings) {
        await context.emit('compliance.finding', {
          rule: finding.rule,
          title: finding.title,
          severity: finding.severity,
          status: finding.status,
          strategy: finding.strategy,
          evidence: finding.evidence,
          detail: finding.detail,
        });
      }
      const blocked = findings.filter((finding) => finding.severity === '阻断');
      const pending = findings.filter((finding) => finding.status === '待审批');
      return {
        audit: `${blocked.length} 项违规、${pending.length} 项待人工确认，规则版本 ${RULE_VERSION}；违规话术已在推演前拦下并改写，此步是对整体方案与逐客话术的复核`,
        payload: { total: findings.length, blocked: blocked.length, pending: pending.length, ruleVersion: RULE_VERSION },
        status: blocked.length ? 'blocked' : pending.length ? 'pending' : 'completed',
      };
    },
  },
  'report.compose': {
    name: 'report.compose',
    title: '输出报告与反思',
    intent: '生成可审计结论并沉淀候选技能',
    async run(context) {
      const result = context.result;
      if (!result || !context.summary) throw new Error('SIMULATION_FAILED');
      const recommended = result.strategies.find((strategy) => strategy.id === result.recommended) ?? result.strategies[0];
      const lines = result.strategies.map(
        (strategy) =>
          `- ${strategy.name}：综合得分 ${(strategy.score * 100).toFixed(1)}，恐慌峰值 ${(strategy.peakPanic * 100).toFixed(1)}%，卖出倾向 ${(strategy.finalSell * 100).toFixed(1)}%，流失风险 ${(strategy.finalChurn * 100).toFixed(1)}%，合规风险 ${strategy.complianceRisk}`,
      );
      const report = [
        '# 客户群体行为压力预演报告',
        '',
        `- 场景：${scenarioLabel(result.scenario)}`,
        `- 目标客群：${result.scenarioMeta.segmentCriteria}`,
        `- 客户数量：${result.customerCount} 名（候选 ${result.scenarioMeta.generatedCustomers} 名）`,
        `- 时间步：${result.scenario.timeSteps} 步，每步 ${result.scenarioMeta.stepHours} 小时`,
        `- 随机种子：${result.seed}`,
        `- 合规规则版本：${result.scenarioMeta.ruleVersion}`,
        `- 执行模式：${context.scenarioSource === 'llm' && context.strategySource === 'llm' ? '模型参与规划与生成' : '规则模式 / 局部降级'}`,
        `- 模型：${context.model ?? '未启用'}`,
        '',
        '## 策略对比',
        ...lines,
        '',
        `## 推荐策略：${recommended.name}`,
        `${recommended.macroPlan.objective}`,
        '',
        '## 合规发现',
        ...(result.findings.length
          ? result.findings.map((finding) => `- [${finding.severity}/${finding.status}] ${finding.rule} ${finding.title}（${finding.strategy}）：${finding.detail}`)
          : ['- 未发现阻断或待审批项']),
        '',
        '> 本报告基于合成脱敏客户数据，仅用于策略压力测试，不构成投资建议，也不代表真实客户预测准确率。',
      ].join('\n');
      return {
        audit: `已生成报告，并把这次的做法存为一条候选技能，等待人工审批`,
        payload: { summary: context.summary, reportMarkdown: report },
      };
    },
  },
};

export const toolNames = Object.keys(toolRegistry) as ToolName[];

export function toolTitle(name: ToolName) {
  return toolRegistry[name]?.title ?? name;
}

export const toolSourceNote = strategyDefinitions.length;
