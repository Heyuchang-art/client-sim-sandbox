import { analyticsToolCatalog, guardrailPolicy } from '../../../../lib/analytics/tools';
import { analyticsGlossary, listMetrics, listTables } from '../../../../lib/analytics/metadata';

/**
 * 取数 Agent 的元数据接口：一次性给出「有哪些工具、哪些表、哪些指标、哪些业务术语」。
 * 模型侧按需调用工具获取，界面侧用它渲染口径说明，两者共用同一份元数据。
 */
export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get('format');
  if (format === 'markdown') {
    const lines = [
      '# 取数元数据',
      '',
      '## 可用表',
      ...listTables().map((table) => `- ${table.name}（${table.label}）：${table.purpose}`),
      '',
      '## 指标口径',
      ...listMetrics().map((metric) => `- ${metric.label}（${metric.name}，单位${metric.unit}）：${metric.definition}`),
      '',
      '## 业务术语',
      ...analyticsGlossary.map((term) => `- ${term.term}：${term.definition}`),
      '',
      '## 工具',
      ...analyticsToolCatalog().map((tool) => `- ${tool.name}（${tool.title}）：${tool.description}`),
    ];
    return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
  }
  return Response.json({
    tools: analyticsToolCatalog(),
    guardrail: guardrailPolicy,
    tables: listTables(),
    metrics: listMetrics(),
    glossary: analyticsGlossary,
  });
}