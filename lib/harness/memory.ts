import type { Customer } from '../simulation';
import type { MemorySummary } from './types';

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

/**
 * 记忆层只沉淀结构化业务事实与行为证据，绝不含模型原始思维链。
 *
 * 重要说明：这里的「行为倾向」与「偏好」都是由合成心理参数派生出的描述，
 * 不是真实的交易或服务观测记录。措辞刻意回避具体天数、次数与历史事件，
 * 以免被读成真实数据。
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
      ? `该原型损失厌恶偏高而纪律性偏低，回撤压力下更容易倾向快速赎回；本组合成参数下的平均持仓回撤为 ${drawdown.toFixed(0)}%。`
      : herding > 0.6
        ? `该原型从众敏感度偏高，社交渠道的情绪变化对其咨询行为影响更大；本组平均从众敏感度为 ${(herding * 100).toFixed(0)}%。`
        : `该原型回撤期间以观察为主，不倾向集中赎回；本组合成参数下的平均持仓回撤为 ${drawdown.toFixed(0)}%。`;
    const preference = trust < 0.45
      ? '机构信任偏低，对批量消息响应意愿弱，更适合一对一人工沟通。'
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
