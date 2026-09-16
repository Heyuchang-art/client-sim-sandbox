import { ensureDatabase } from '../../../../lib/db-runtime';

/**
 * 结构化报告：默认返回 JSON，?format=markdown 返回可直接导出的文本报告。
 * 报告包含场景参数、模型与规则版本、随机种子，用于审计还原。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const format = new URL(request.url).searchParams.get('format') ?? 'json';
  const db = await ensureDatabase();
  const task = await db.prepare(
    `SELECT id, prompt, status, mode, plan_json AS planJson, scenario_json AS scenarioJson, simulation_id AS simulationId,
      result_json AS resultJson, error_code AS errorCode, model, created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt
     FROM tasks WHERE id = ?`,
  ).bind(id).first<Record<string, unknown>>();
  if (!task) return Response.json({ error: '未找到报告。' }, { status: 404 });

  let simulation: Record<string, unknown> | null = null;
  const simulationId = typeof task.simulationId === 'string' ? task.simulationId : null;
  if (simulationId) {
    simulation = await db.prepare(
      `SELECT recommended_strategy AS recommendedStrategy, summary_json AS summaryJson, audit_json AS auditJson,
        findings_json AS findingsJson, scenario_json AS scenarioJson, scenario_meta_json AS scenarioMetaJson,
        rule_version AS ruleVersion, model, engine_ms AS engineMs, states_truncated AS statesTruncated, seed
       FROM simulation_runs WHERE id = ?`,
    ).bind(simulationId).first<Record<string, unknown>>();
  }

  const parse = (value: unknown, fallback: unknown) => {
    if (typeof value !== 'string' || !value) return fallback;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return fallback;
    }
  };

  const summary = simulation ? (parse(simulation.summaryJson, null) as { reportMarkdown?: string | null } | null) : null;
  const report = {
    taskId: task.id,
    prompt: task.prompt,
    status: task.status,
    mode: task.mode,
    model: simulation?.model ?? task.model,
    ruleVersion: simulation?.ruleVersion ?? null,
    seed: simulation?.seed ?? null,
    engineMs: simulation?.engineMs ?? null,
    statesTruncated: Boolean(simulation?.statesTruncated),
    scenario: parse(simulation?.scenarioJson ?? task.scenarioJson, null),
    scenarioMeta: parse(simulation?.scenarioMetaJson, null),
    plan: parse(task.planJson, null),
    recommendedStrategy: simulation?.recommendedStrategy ?? null,
    summary: summary ? { ...summary, reportMarkdown: undefined } : null,
    audit: parse(simulation?.auditJson, []),
    findings: parse(simulation?.findingsJson, []),
    markdown: summary?.reportMarkdown ?? null,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    errorCode: task.errorCode,
    disclaimer: '本报告基于合成脱敏客户数据，仅用于策略压力测试，不构成投资建议，也不代表真实客户预测准确率。',
  };

  if (format === 'markdown') {
    const taskIdText = typeof report.taskId === 'string' ? report.taskId : '';
    const ruleVersionText = typeof report.ruleVersion === 'string' ? report.ruleVersion : '—';
    const modelText = typeof report.model === 'string' ? report.model : '未启用';
    const seedText = typeof report.seed === 'number' || typeof report.seed === 'string' ? String(report.seed) : '—';
    const body = report.markdown ?? '# 客户群体行为压力预演报告\n\n任务 ' + taskIdText + ' 尚未生成结构化报告。';
    const composed = body + '\n\n---\n\n审计信息：规则版本 ' + ruleVersionText + ' · 模型 ' + modelText + ' · 随机种子 ' + seedText + '\n\n' + report.disclaimer + '\n';
    return new Response(composed, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  }

  return Response.json({ report });
}
