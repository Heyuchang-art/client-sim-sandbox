import { ensureDatabase } from '../../../../lib/db-runtime';

/**
 * 取数评测的人工复核接口。
 *
 * 赛题攻关任务三要求「子 agent 打分 + 人工复核」：评测脚本先用确定性口径比对，
 * 低分项再交给模型打分，最终由人工在此确认结论。复核记录只用于统计复核工作量与
 * 修正评测口径，不自动修改引擎或提示词——避免把人工结论直接变成「自我训练」。
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    caseId?: string;
    verdict?: string;
    comment?: string;
    reviewedBy?: string;
  };
  const caseId = body.caseId?.trim();
  if (!caseId) return Response.json({ error: '缺少 caseId。' }, { status: 400 });
  const verdict = body.verdict?.trim() ?? '待复核';
  if (!['正确', '错误', '待复核'].includes(verdict)) {
    return Response.json({ error: 'verdict 只能是 正确 / 错误 / 待复核。' }, { status: 400 });
  }

  const db = await ensureDatabase();
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO analytics_reviews (id, case_id, verdict, comment, reviewed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, caseId.slice(0, 40), verdict, body.comment?.slice(0, 500) ?? null, body.reviewedBy?.slice(0, 60) ?? 'analyst_demo', Date.now())
    .run();
  return Response.json({ id, caseId, verdict }, { status: 201 });
}

export async function GET(request: Request) {
  const caseId = new URL(request.url).searchParams.get('caseId');
  const db = await ensureDatabase();
  const statement = caseId
    ? db.prepare('SELECT id, case_id AS caseId, verdict, comment, reviewed_by AS reviewedBy, created_at AS createdAt FROM analytics_reviews WHERE case_id = ? ORDER BY created_at DESC LIMIT 100').bind(caseId)
    : db.prepare('SELECT id, case_id AS caseId, verdict, comment, reviewed_by AS reviewedBy, created_at AS createdAt FROM analytics_reviews ORDER BY created_at DESC LIMIT 100');
  const { results } = await statement.all<Record<string, unknown>>();
  const byVerdict: Record<string, number> = {};
  for (const row of results) {
    const key = typeof row.verdict === 'string' ? row.verdict : '待复核';
    byVerdict[key] = (byVerdict[key] ?? 0) + 1;
  }
  return Response.json({ reviews: results, byVerdict });
}