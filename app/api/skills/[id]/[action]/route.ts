import { ensureDatabase } from '../../../../../lib/db-runtime';

const actions = new Set(['approve', 'reject', 'rollback']);

/**
 * 候选 Skill 的人工审批与版本回滚。
 * 系统不做无审批的在线学习：只有 approved 的技能会被后续任务复用。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await context.params;
  if (!actions.has(action)) return Response.json({ error: '不支持的操作。' }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { actor?: string };
  const actor = body.actor?.trim() || 'compliance_reviewer';
  const db = await ensureDatabase();

  const skill = await db.prepare('SELECT id, name, version, status FROM skills WHERE id = ?').bind(id).first<{
    id: string;
    name: string;
    version: number;
    status: string;
  }>();
  if (!skill) return Response.json({ error: '未找到技能。' }, { status: 404 });

  if (action === 'approve') {
    await db.prepare('UPDATE skills SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?').bind('approved', Date.now(), actor, id).run();
    return Response.json({ id, status: 'approved', actor });
  }

  if (action === 'reject') {
    await db.prepare('UPDATE skills SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?').bind('rejected', Date.now(), actor, id).run();
    return Response.json({ id, status: 'rejected', actor });
  }

  const current = await db
    .prepare("SELECT id, version FROM skills WHERE name = ? AND status = 'approved' ORDER BY version DESC LIMIT 1")
    .bind(skill.name)
    .first<{ id: string; version: number }>();
  if (!current) return Response.json({ error: '该技能没有可回滚的历史版本。' }, { status: 409 });
  const previous = await db
    .prepare("SELECT id, version FROM skills WHERE name = ? AND version < ? AND status IN ('archived','approved') ORDER BY version DESC LIMIT 1")
    .bind(skill.name, current.version)
    .first<{ id: string; version: number }>();
  if (!previous) return Response.json({ error: '该技能没有更早的版本。' }, { status: 409 });

  await db.batch([
    db.prepare('UPDATE skills SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?').bind('archived', Date.now(), actor, current.id),
    db.prepare('UPDATE skills SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?').bind('approved', Date.now(), actor, previous.id),
  ]);
  return Response.json({ rolledBackFrom: current.version, restoredVersion: previous.version, actor });
}
