/**
 * 取数 Agent 评测：50 条自造问答对的执行准确率。
 *
 * 评测口径（先定口径再看结果，避免「结果好就是对的」）：
 *   - 基准值由人工编写的黄金 SQL 在**同一份数据**上执行得到，不是拿实现里的常量当真值；
 *   - 数值类：Agent 结果与基准值的相对误差不超过 2% 视为一致；
 *   - 名单/分组类：按分组标签对齐，黄金 SQL 出现的每个分组都必须在结果里存在且数值一致；
 *   - 数值列按多重集比较（不比较列顺序），列名差异不判错——评测的是数对不对，不是别名怎么写。
 *   - 识别不到指标、围栏拦截、执行报错，都计为失败，不存在「跳过即通过」。
 *
 * 数据是合成数据，黄金 SQL 由团队自写，因此本结果只说明「在自造数据与自造语料上」的
 * 执行准确率，不能外推为真实数据集上的准确率。官方数据集到位后应重跑本脚本。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyticsDdl, analyticsIndexes } from '../lib/analytics/schema';
import { ensureAnalyticsData } from '../lib/analytics/seed';
import { askAnalytics } from '../lib/analytics/agent';
import { loadModelConfig } from '../lib/model/adapter';
import { readRuntimeEnv } from '../lib/harness/env';

export type AskEvalCase = {
  id: string;
  level: string;
  question: string;
  golden: string | null;
  /** decline 表示这条问题超出当前元数据覆盖面，正确行为是明确拒答而不是猜一个数 */
  expect: { kind: 'number' | 'rows' | 'decline'; column: string };
};

export type AskEvalResult = {
  id: string;
  level: string;
  question: string;
  mode: string;
  sql: string;
  ok: boolean;
  reason: string;
  goldenValue: number[] | null;
  actualValue: number[] | null;
  latencyMs: number;
};

export type AskEvalReport = {
  generatedAt: string;
  version: string;
  /** 语料标签：样本内（自造语料）/ 留出集（另写一套问法做交叉验证） */
  label: string;
  corpusPath: string;
  total: number;
  accuracy: number;
  threshold: number;
  passed: boolean;
  modelConfigured: boolean;
  byLevel: Record<string, { total: number; ok: number; accuracy: number }>;
  modeCounts: Record<string, number>;
  failures: AskEvalResult[];
  results: AskEvalResult[];
  notes: string[];
};

const relativeTolerance = 0.02;

export function loadAskEvalCases(path = resolve(process.cwd(), 'evals', 'ask-corpus.jsonl')): AskEvalCase[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AskEvalCase);
}

/** 把 node:sqlite 包装成运行时用的 D1 接口，保证评测跑的是与线上同一条代码路径。 */
export function createLocalDb(sqlite: DatabaseSync) {
  const wrap = (statement: ReturnType<DatabaseSync['prepare']>) => ({
    bind: (...values: unknown[]) => ({
      run: async () => statement.run(...(values as never[])),
      all: async () => ({ results: statement.all(...(values as never[])) as Array<Record<string, unknown>> }),
      first: async () => (statement.get(...(values as never[])) ?? null) as Record<string, unknown> | null,
    }),
    run: async () => statement.run(),
    all: async () => ({ results: statement.all() as Array<Record<string, unknown>> }),
    first: async () => (statement.get() ?? null) as Record<string, unknown> | null,
  });
  return {
    prepare: (sql: string) => wrap(sqlite.prepare(sql)),
    batch: async (statements: unknown[]) => {
      const output: unknown[] = [];
      for (const statement of statements as Array<{ run: () => Promise<unknown> }>) output.push(await statement.run());
      return output;
    },
  };
}

function numericValues(row: Record<string, unknown> | undefined, prefer: string) {
  if (!row) return null;
  if (prefer && typeof row[prefer] === 'number') return [row[prefer] as number];
  const values = Object.values(row).filter((value): value is number => typeof value === 'number');
  return values.length > 0 ? values.sort((a, b) => a - b) : null;
}

function numbersMatch(actual: number[] | null, golden: number[] | null) {
  if (!actual || !golden) return false;
  if (actual.length !== golden.length) return false;
  return golden.every((expected, index) => {
    const got = actual[index];
    return Math.abs(got - expected) <= Math.max(relativeTolerance * Math.abs(expected), 1e-9);
  });
}

function labelOf(row: Record<string, unknown>) {
  const first = Object.values(row)[0];
  if (typeof first === 'string') return first;
  if (typeof first === 'number') return String(first);
  return '';
}

export function compareCase(
  testCase: AskEvalCase,
  goldenRows: Array<Record<string, unknown>>,
  actualRows: Array<Record<string, unknown>>,
  actualSql = '',
): { ok: boolean; reason: string; goldenValue: number[] | null; actualValue: number[] | null } {
  if (testCase.expect.kind === 'decline') {
    if (!actualSql) return { ok: true, reason: '已明确拒答并提示换问法', goldenValue: null, actualValue: null };
    return { ok: false, reason: '超出元数据覆盖面却仍然给出了答案', goldenValue: null, actualValue: numericValues(actualRows[0], '') };
  }
  if (testCase.expect.kind === 'number') {
    const goldenValue = numericValues(goldenRows[0], testCase.expect.column);
    const actualValue = numericValues(actualRows[0], testCase.expect.column);
    if (!goldenValue) return { ok: false, reason: '黄金 SQL 未返回数值，语料本身需要修', goldenValue: null, actualValue };
    if (!actualValue) return { ok: false, reason: '结果里没有数值列', goldenValue, actualValue: null };
    const ok = numbersMatch(actualValue, goldenValue);
    return {
      ok,
      reason: ok ? '一致' : `数值不一致：基准 ${goldenValue.join('/')}，实际 ${actualValue.join('/')}`,
      goldenValue,
      actualValue,
    };
  }

  const goldenMap = new Map(goldenRows.map((row) => [labelOf(row), row]));
  const actualMap = new Map(actualRows.map((row) => [labelOf(row), row]));
  if (goldenMap.size === 0) return { ok: false, reason: '黄金 SQL 未返回分组，语料本身需要修', goldenValue: null, actualValue: null };
  for (const [label, goldenRow] of goldenMap) {
    const actualRow = actualMap.get(label);
    if (!actualRow) return { ok: false, reason: `缺少分组「${label}」`, goldenValue: null, actualValue: null };
    const goldenValue = numericValues(goldenRow, '');
    const actualValue = numericValues(actualRow, '');
    if (!numbersMatch(actualValue, goldenValue)) {
      return {
        ok: false,
        reason: `分组「${label}」数值不一致：基准 ${goldenValue?.join('/') ?? '无'}，实际 ${actualValue?.join('/') ?? '无'}`,
        goldenValue,
        actualValue,
      };
    }
  }
  if (actualMap.size < goldenMap.size) return { ok: false, reason: '结果行数少于基准', goldenValue: null, actualValue: null };
  return { ok: true, reason: `分组全部一致（共 ${goldenMap.size} 组）`, goldenValue: null, actualValue: null };
}

function rate(ok: number, total: number) {
  return total === 0 ? 0 : Number((ok / total).toFixed(4));
}

export async function runAskEval(options: { useModel?: boolean; corpusPath?: string; label?: string } = {}): Promise<AskEvalReport> {
  const corpusPath = options.corpusPath ?? resolve(process.cwd(), 'evals', 'ask-corpus.jsonl');
  const label = options.label ?? '样本内语料';
  const cases = loadAskEvalCases(corpusPath);
  const sqlite = new DatabaseSync(':memory:');
  for (const ddl of [...analyticsDdl(), ...analyticsIndexes]) sqlite.exec(ddl);
  const db = createLocalDb(sqlite);
  await ensureAnalyticsData(db);

  const env = await readRuntimeEnv();
  const config = options.useModel ? loadModelConfig(env) : null;

  const results: AskEvalResult[] = [];
  for (const testCase of cases) {
    let goldenRows: Array<Record<string, unknown>> = [];
    try {
      // 边界集没有黄金 SQL：它们本来就不该被回答
      goldenRows = testCase.golden ? (sqlite.prepare(testCase.golden).all() as Array<Record<string, unknown>>) : [];
    } catch (error) {
      results.push({
        id: testCase.id, level: testCase.level, question: testCase.question, mode: 'golden',
        sql: '', ok: false, reason: `黄金 SQL 执行失败：${error instanceof Error ? error.message : '未知错误'}`,
        goldenValue: null, actualValue: null, latencyMs: 0,
      });
      continue;
    }

    const startedAt = Date.now();
    const answer = await askAnalytics(db as never, testCase.question, config);
    const latencyMs = Date.now() - startedAt;
    // 执行报错同样计为失败：整个流程不能因为一条查询挂掉而中断
    let actualRows: Array<Record<string, unknown>> = [];
    let executionError: string | null = null;
    if (answer.sql) {
      try {
        actualRows = sqlite.prepare(answer.sql).all() as Array<Record<string, unknown>>;
      } catch (error) {
        executionError = error instanceof Error ? error.message : '未知错误';
      }
    }
    const comparison = executionError
      ? { ok: false, reason: '执行失败：' + executionError, goldenValue: null, actualValue: null }
      : testCase.expect.kind === 'decline'
        ? compareCase(testCase, goldenRows, actualRows, answer.sql)
        : answer.sql
          ? compareCase(testCase, goldenRows, actualRows, answer.sql)
          : { ok: false, reason: '未规划出查询（规则路径无法理解该问法，且未配置模型）', goldenValue: null, actualValue: null };

    results.push({
      id: testCase.id, level: testCase.level, question: testCase.question, mode: answer.mode,
      sql: answer.sql, ok: comparison.ok, reason: comparison.reason,
      goldenValue: comparison.goldenValue, actualValue: comparison.actualValue, latencyMs,
    });
  }

  const ok = results.filter((item) => item.ok).length;
  const byLevel: Record<string, { total: number; ok: number; accuracy: number }> = {};
  for (const item of results) {
    const bucket = byLevel[item.level] ?? { total: 0, ok: 0, accuracy: 0 };
    bucket.total += 1;
    if (item.ok) bucket.ok += 1;
    bucket.accuracy = rate(bucket.ok, bucket.total);
    byLevel[item.level] = bucket;
  }
  const modeCounts: Record<string, number> = {};
  for (const item of results) modeCounts[item.mode] = (modeCounts[item.mode] ?? 0) + 1;

  const version = (JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version;
  const notes = config
    ? ['本次为模型路径评测：SQL 由模型生成，仍会经过三层安全围栏校验。']
    : ['未配置模型密钥，本次为规则路径（确定性规划器）评测——它是模型不可用时的兜底路径。'];

  return {
    generatedAt: new Date().toISOString(),
    version,
    label,
    corpusPath,
    total: results.length,
    accuracy: rate(ok, results.length),
    threshold: 0.9,
    passed: rate(ok, results.length) >= 0.9,
    modelConfigured: config !== null,
    byLevel,
    modeCounts,
    failures: results.filter((item) => !item.ok),
    results,
    notes,
  };
}

export function formatAskEval(report: AskEvalReport) {
  const lines = [
    '## ' + report.label + '（' + report.generatedAt.slice(0, 10) + ' v' + report.version + '）',
    '',
    report.label.includes('边界')
      ? '- 样本 ' + report.total + ' 条 · 正确拒答 ' + (report.accuracy * 100).toFixed(1) + '%（' + report.results.filter((item) => item.ok).length + '/' + report.total + '）' + (report.failures.length > 0 ? '· 其中 ' + report.failures.length + ' 条「超出元数据覆盖面却仍给出了答案」，属于已知能力缺口' : '')
      : '- 样本 ' + report.total + ' 条 · 执行准确率 ' + (report.accuracy * 100).toFixed(1) + '% · 阈值 ' + (report.threshold * 100).toFixed(0) + '% · ' + (report.passed ? '通过' : '未达标'),
    '- 执行模式：' + Object.entries(report.modeCounts).map(([key, value]) => key + '=' + value).join('，'),
    '- 分档：' + Object.entries(report.byLevel).map(([key, value]) => key + ' ' + (value.accuracy * 100).toFixed(1) + '%（' + value.ok + '/' + value.total + '）').join(' · '),
    '',
    '## 失败明细',
    '',
  ];
  if (report.failures.length === 0) lines.push('- 无');
  else for (const item of report.failures) lines.push('- ' + item.id + '（' + item.level + '）' + item.question + '：' + item.reason);
  lines.push('', '> ' + report.notes.join(' '));
  lines.push('> 数据与语料均为团队自造，结果不外推到真实数据集；官方数据到位后应重跑本脚本。');
  return lines.join('\n');
}

async function main() {
  const useModel = process.argv.includes('--model');
  const directory = resolve(process.cwd(), 'artifacts', 'metrics');
  mkdirSync(directory, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);

  // 样本内语料：规划器在开发过程中反复运行过，数字会偏乐观；
  // 留出集：另一套问法，只在定稿时跑一次，用来检验「换个说法还准不准」。
  const main = await runAskEval({ useModel, corpusPath: resolve(process.cwd(), 'evals', 'ask-corpus.jsonl'), label: '样本内语料（50 条）' });
  const optional: AskEvalReport[] = [];
  for (const [file, label] of [['ask-heldout.jsonl', '留出集（15 条，交叉验证）'], ['ask-boundary.jsonl', '能力边界集（12 条，预期会出现拒答）']]) {
    try {
      optional.push(await runAskEval({ useModel, corpusPath: resolve(process.cwd(), 'evals', file), label }));
    } catch (error) {
      console.log(file + ' 未运行：' + (error instanceof Error ? error.message : '未知错误'));
    }
  }

  const reports = [main, ...optional];
  writeFileSync(resolve(directory, date + '-ask-eval.json'), JSON.stringify({ main, optional }, null, 2));
  const markdown = ['# 取数 Agent 评测（' + date + ' v' + main.version + '）', '', ...reports.map(formatAskEval), ''].join('\n');
  writeFileSync(resolve(directory, 'latest-ask-eval.md'), markdown);
  console.log(markdown);
  console.log('\n写入：' + resolve(directory, date + '-ask-eval.json'));
}

const invokedDirectly = process.argv[1]?.includes('eval-ask');
if (invokedDirectly) await main();