import type { Customer } from '../simulation';
import type { MemorySummary } from './types';

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

/**
 * 记忆层只沉淀结构化业务事实与行为证据，绝不含模型原始思维链。
 */
export function buildMemorySummaries(customers: Customer[]): MemorySummary[] {
  const groups = new Map<string, Customer[]>();
  customers.forEach((customer) => {
    const group = groups.get(customer.archetype) ?? [];
    group.push(customer);
    groups.set(customer.archetype, group);
  });

  return [...groups.entries()].map(([archetype, group]) => {
    const lossAversion = average(group.map((customer) => customer.psychology.lossAversion));
    const herding = average(group.map((customer) => customer.psychology.herding));
    const discipline = average(group.map((customer) => customer.psychology.discipline));
    const patience = average(group.map((customer) => customer.psychology.patience));
    const trust = average(group.map((customer) => customer.psychology.trust));
    const drawdown = average(group.map((customer) => customer.drawdown));

    const behavior = lossAversion > 0.62 && discipline < 0.6
      ? `历史回撤超过 ${drawdown.toFixed(0)}% 时倾向快速赎回，近 30 日出现 ${Math.round(herding * 6)} 次高频查看净值。`
      : herding > 0.6
        ? `在社交渠道获取信息较多，同群情绪变化时咨询量上升约 ${Math.round(herding * 40)}%。`
        : `回撤期间以观察为主，历史回撤 ${drawdown.toFixed(0)}% 时未出现集中赎回。`;
    const preference = trust < 0.45
      ? '近 30 日无主动咨询记录，对机构消息响应偏弱，更接受一对一人工沟通。'
      : patience > 0.65
        ? '更接受包含量化依据的简短说明，愿意讨论长期期限。'
        : '更接受即时、明确的处理路径说明，对强刺激与催促表达敏感。';

    return {
      archetype,
      behavior,
      preference,
      evidence: [
        `样本 ${group.length} 名`,
        `平均回撤 ${drawdown.toFixed(1)}%`,
        `损失厌恶 ${(lossAversion * 100).toFixed(0)}%`,
        `从众敏感 ${(herding * 100).toFixed(0)}%`,
        `机构信任 ${(trust * 100).toFixed(0)}%`,
      ],
    };
  });
}

export function memoryForArchetype(summaries: MemorySummary[], archetype: string) {
  return summaries.find((summary) => summary.archetype === archetype) ?? null;
}
