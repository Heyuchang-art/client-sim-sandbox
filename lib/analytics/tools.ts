/**
 * 取数 Agent 的工具层：把元数据、取数能力封装成模型可调用的工具。
 *
 * 对应赛题攻关任务一的原文要求——「元数据的组织形式：工具设计，大模型可以通过工具
 * 获取有效的上下文」。这里刻意不把九张表的全部元数据一次性塞进提示词：
 *   - 模型先调 metadata.tables 看有哪些表；
 *   - 再调 metadata.describe 看某张表有哪些列；
 *   - 需要业务口径时调 metadata.glossary；
 *   - 需要指标口径时调 metadata.metrics；
 *   - 最后调 analytics.ask 完成一次取数。
 * 这样上下文是按需取用的，既省 token，也避免「元数据太长、模型只看了开头」。
 *
 * 这一层与沙盘推演流水线（lib/harness/tools.ts 的八个步骤）是两条不同的业务链路：
 * 取数 Agent 是赛题要求的主场景，推演是取数之后的下游能力，因此工具注册表分开维护。
 */
import { askAnalytics, type D1Like } from './agent';
import { analyticsGlossary, analyticsMetrics, describeTable, listMetrics, listTables, lookupGlossary } from './metadata';
import { guardrailMaxRows, guardrailResultRowLimit } from './guardrail';
import type { ModelConfig } from '../model/adapter';

export type AnalyticsToolContext = {
  db: D1Like;
  config: ModelConfig | null;
};

export type AnalyticsToolArg = {
  name: string;
  type: 'string';
  required: boolean;
  description: string;
};

export type AnalyticsTool = {
  name: string;
  title: string;
  /** 模型据此判断什么时候该调用这个工具 */
  description: string;
  args: AnalyticsToolArg[];
  run: (args: Record<string, unknown>, context: AnalyticsToolContext) => Promise<Record<string, unknown>>;
};

function text(value: unknown, limit = 300) {
  return typeof value === 'string' ? value.slice(0, limit).trim() : '';
}

export const analyticsTools: AnalyticsTool[] = [
  {
    name: 'metadata.tables',
    title: '查看可用的数据表',
    description: '列出当前数据仓库里全部可用表及其用途，用来判断一个问题该查哪几张表。',
    args: [],
    async run() {
      return { tables: listTables() };
    },
  },
  {
    name: 'metadata.describe',
    title: '查看某张表的字段',
    description: '给出指定表的字段名、中文名、字段类型与业务口径，写 SQL 前必须先查这一步。',
    args: [{ name: 'table', type: 'string', required: true, description: '表名，取自 metadata.tables 的返回结果' }],
    async run(args) {
      const table = text(args.table, 60);
      const described = describeTable(table);
      if (!described) return { error: `未登记的表：${table}`, hint: '请先用 metadata.tables 查看可用表名。' };
      return described;
    },
  },
  {
    name: 'metadata.metrics',
    title: '查看指标口径',
    description: '列出已登记指标的名称、口径说明、单位与依赖表。指标未登记时不允许在查询里自行发明。',
    args: [],
    async run() {
      return { metrics: listMetrics() };
    },
  },
  {
    name: 'metadata.glossary',
    title: '查询业务术语口径',
    description: '把「高净值客户」「活跃客户」这类业务说法翻译成具体的字段与阈值条件。',
    args: [{ name: 'term', type: 'string', required: false, description: '术语名；留空返回全部术语' }],
    async run(args) {
      const term = text(args.term, 40);
      if (!term) return { glossary: analyticsGlossary };
      const matched = lookupGlossary(term);
      return matched.length > 0 ? { terms: matched } : { error: `未收录的术语：${term}`, glossary: analyticsGlossary };
    },
  },
  {
    name: 'analytics.ask',
    title: '执行一次取数',
    description: '把自然语言问题翻译成一条只读查询，经三层安全围栏校验后执行并返回结果。',
    args: [{ name: 'question', type: 'string', required: true, description: '用户的自然语言问题' }],
    async run(args, context) {
      const question = text(args.question, 200);
      if (!question) return { error: '问题不能为空。' };
      return askAnalytics(context.db, question, context.config);
    },
  },
];

export const analyticsToolNames = analyticsTools.map((tool) => tool.name);

/** 供接口与界面展示的工具目录：只描述「能做什么」，不含实现细节。 */
export function analyticsToolCatalog() {
  return analyticsTools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    args: tool.args,
  }));
}

/** 安全围栏的对外说明，供界面展示校验口径，避免「拦了什么」说不清。 */
export const guardrailPolicy = {
  maxRows: guardrailMaxRows,
  displayRows: guardrailResultRowLimit,
  layers: [
    { layer: '结构层', rules: '单条语句、只读、禁止注释、必须带行数上限' },
    { layer: '语义层', rules: '表名白名单、字段白名单、指标必须已登记' },
    { layer: '结果层', rules: '行数列数上限、空结果提示、金额与比率合理性检查' },
  ],
  metricCount: analyticsMetrics.length,
};