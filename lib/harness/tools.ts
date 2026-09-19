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
  relativeUtilityBreakdown,
} from '../simulation';
import { askAnalytics, type D1Like } from '../analytics/agent';
import { listMetrics, listTables, lookupGlossary, describeTable } from '../analytics/metadata';
import { buildMemorySummaries } from './memory';
import { draftStrategiesWithModel, extractScenarioWithModel, planSteps } from './planner';
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
  /** 数据连接：取数类工具用它执行查询；推演流水线不需要，因此允许为空 */
  db: D1Like | null;
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

/**
 * 步骤标题与说明的单一来源是 planner 的规范步骤定义。
 * 这里不再各存一份，避免「改了一处、漏了另一处」——本轮已因此漏过一次。
 */
const stepMeta = (tool: ToolName) => {
  const step = planSteps.find((item) => item.tool === tool);
  return { title: step?.title ?? tool, intent: step?.intent ?? '' };
};

export const toolRegistry: Record<ToolName, HarnessTool> = {
  'scenario.extract': {
    name: 'scenario.extract',
    ...stepMeta('scenario.extract'),
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
    ...stepMeta('customers.query'),
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
    ...stepMeta('profile.build'),
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
    ...stepMeta('graph.build'),
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
    ...stepMeta('strategy.draft'),
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
    ...stepMeta('simulation.run'),
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
    ...stepMeta('compliance.review'),
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
  // ——— 取数 Agent 的工具（赛题攻关任务一：元数据以工具形式暴露）———
  // 这五个工具不在推演流水线的固定八步里：它们服务于「自然语言取数」这条链路，
  // 由 /api/analytics/ask 与 metadata 接口调用，注册在这里是为了让平台只有一张工具表。
  'metadata.tables': {
    name: 'metadata.tables',
    title: '查看可用数据表',
    intent: '列出九张业务表及用途，用于判断一个问题该查哪几张表',
    async run() {
      const tables = listTables();
      return { audit: `返回 ${tables.length} 张业务表`, payload: { tables } };
    },
  },
  'metadata.describe': {
    name: 'metadata.describe',
    title: '查看表字段',
    intent: '给出指定表的字段、类型与业务口径，写查询前必须先查这一步',
    async run(context) {
      const table = typeof context.prompt === 'string' ? context.prompt.trim().slice(0, 60) : '';
      const described = describeTable(table);
      return described
        ? { audit: `返回 ${table} 的 ${described.columns.length} 个字段`, payload: { table: described } }
        : { audit: `未登记的表：${table}`, payload: { error: '未登记的表' }, status: 'blocked' as const };
    },
  },
  'metadata.metrics': {
    name: 'metadata.metrics',
    title: '查看指标口径',
    intent: '列出已登记指标的口径、单位与依赖表，未登记指标不允许自行发明',
    async run() {
      const metrics = listMetrics();
      return { audit: `返回 ${metrics.length} 个已登记指标`, payload: { metrics } };
    },
  },
  'metadata.glossary': {
    name: 'metadata.glossary',
    title: '查询业务术语',
    intent: '把「高净值客户」「活跃客户」这类业务说法翻译成字段与阈值条件',
    async run(context) {
      const term = typeof context.prompt === 'string' ? context.prompt.trim().slice(0, 40) : '';
      const terms = lookupGlossary(term || undefined);
      return { audit: `返回 ${terms.length} 条术语口径`, payload: { terms } };
    },
  },
  'analytics.ask': {
    name: 'analytics.ask',
    title: '执行一次取数',
    intent: '把自然语言问题翻译成只读查询，经三层安全围栏校验后执行并返回结果',
    async run(context) {
      if (!context.db) {
        return { audit: '当前运行环境没有可用的数据连接，取数工具未执行。', payload: { skipped: true }, status: 'blocked' as const };
      }
      const question = typeof context.prompt === 'string' ? context.prompt.trim().slice(0, 200) : '';
      if (!question) {
        return { audit: '问题为空，取数工具未执行。', payload: { skipped: true }, status: 'blocked' as const };
      }
      const answer = await askAnalytics(context.db, question, context.config);
      const blocked = answer.guardrail.findings.filter((finding) => finding.disposition === '拦截');
      return {
        audit: `${answer.mode === 'llm' ? '模型' : '规则'}路径生成查询，安全围栏${answer.guardrail.passed ? '通过' : `拦截（${blocked.map((finding) => finding.rule).join('、')}）`}，返回 ${answer.rowCount} 行`,
        payload: { ...answer },
        status: answer.guardrail.passed ? 'completed' : 'blocked',
      };
    },
  },
  'report.compose': {
    name: 'report.compose',
    ...stepMeta('report.compose'),
    async run(context) {
      const result = context.result;
      if (!result || !context.summary) throw new Error('SIMULATION_FAILED');
      const recommended = result.strategies.find((strategy) => strategy.id === result.recommended) ?? result.strategies[0];
      // 与界面同口径：综合推荐度以「不主动沟通」为 0 分基准，避免报告与界面数字对不上。
      const baselineStrategy = result.strategies.find((strategy) => strategy.id === 'baseline') ?? result.strategies[0];
      const breakdown = relativeUtilityBreakdown(
        result.utilityWeights,
        baselineStrategy.utility,
        result.strategies.map((strategy) => strategy.utility),
      );
      const lines = result.strategies.map(
        (strategy, index) =>
          `- ${strategy.name}：综合推荐度 ${breakdown.all[index].total.toFixed(2)}（以「不主动沟通」为 0 分基准），恐慌峰值 ${(strategy.peakPanic * 100).toFixed(1)}%，卖出倾向 ${(strategy.finalSell * 100).toFixed(1)}%，流失风险 ${(strategy.finalChurn * 100).toFixed(1)}%，合规风险 ${strategy.complianceRisk}`,
      );
      const report = [
        '# 客户群体行为压力预演报告',
        '',
        `- 场景：${scenarioLabel(result.scenario)}`,
        `- 目标客群：${result.scenarioMeta.segmentCriteria}`,
        `- 客户数量：${result.customerCount} 名（候选 ${result.scenarioMeta.generatedCustomers} 名）`,
        `- 推演段数：共 ${result.scenario.timeSteps} 段，每段 ${result.scenarioMeta.stepHours} 小时`,
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
