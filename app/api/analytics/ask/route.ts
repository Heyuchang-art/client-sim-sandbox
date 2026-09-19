import { ensureDatabase } from '../../../../lib/db-runtime';
import { loadModelConfig } from '../../../../lib/model/adapter';
import { readRuntimeEnv } from '../../../../lib/harness/env';
import { askAnalytics } from '../../../../lib/analytics/agent';
import { askExamples } from '../../../../lib/analytics/ask';

/**
 * 取数问答接口：自然语言问题 → 生成查询 → 三层安全围栏校验 → 执行 → 结果与解释。
 *
 * 两条生成路径：模型路径（有密钥时）与规则路径（确定性规划器）。
 * 两条路径都要过同一道安全围栏；模型写出的 SQL 被拦下时自动降级到规则路径，
 * 响应里的 mode 字段如实标注本次结果究竟来自哪条路径，不把规则结果包装成模型结果。
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: string };
  const question = body.question?.trim() ?? '';
  if (!question) {
    return Response.json({ error: '问题不能为空。', examples: askExamples }, { status: 400 });
  }
  if (question.length > 200) {
    return Response.json({ error: '问题过长，请控制在 200 字以内。' }, { status: 400 });
  }

  const db = await ensureDatabase();
  const config = loadModelConfig(await readRuntimeEnv());
  const answer = await askAnalytics(db as never, question, config);

  const understood = answer.sql.length > 0;
  return Response.json(
    { ...answer, understood, interpreted: answer.explanation || '未能规划出查询' },
    { status: understood ? 200 : 422 },
  );
}

export async function GET() {
  return Response.json({ examples: askExamples });
}