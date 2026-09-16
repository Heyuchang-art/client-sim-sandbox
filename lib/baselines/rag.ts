/**
 * 内置投教/产品/合规语料与 BM25 检索器。
 * 说明：对照基线 llm-rag 使用本地内置语料，不引入 pgvector 或外部向量库，
 * 保证在无网络、无密钥的评测环境下也能复现。
 */

export type KnowledgeDoc = {
  id: string;
  topic: '投教' | '产品' | '合规' | '流程';
  text: string;
};

export const knowledgeCorpus: KnowledgeDoc[] = [
  { id: 'KB-01', topic: '投教', text: '投资者适当性管理要求证券经营机构了解客户风险承受能力，并推荐风险等级不高于客户等级的产品。' },
  { id: 'KB-02', topic: '投教', text: '市场大幅下跌时，机构应引导客户关注长期目标与资产配置，而不是做出情绪化的短期决策。' },
  { id: 'KB-03', topic: '投教', text: '亏损厌恶会显著放大客户在回撤期间的赎回冲动，沟通应提供量化依据而非情绪安抚。' },
  { id: 'KB-04', topic: '投教', text: '客户教育材料不得包含保本保收益、稳赚不赔等表述，也不得对未来收益作出承诺。' },
  { id: 'KB-05', topic: '投教', text: '投资者教育应提示基金、资管产品的历史业绩不代表未来表现，投资需谨慎。' },
  { id: 'KB-06', topic: '产品', text: '高波动权益类产品的净值回撤可达两位数百分比，客户应具备相应的风险承受能力与持有期限。' },
  { id: 'KB-07', topic: '产品', text: '量化增强产品的风险等级通常高于普通混合型产品，适合风险等级 C3 及以上的客户。' },
  { id: 'KB-08', topic: '产品', text: '科技成长组合波动率高、行业集中度大，短期回撤可能显著高于宽基指数。' },
  { id: 'KB-09', topic: '产品', text: '固收类与货币类产品波动较小，适合风险偏好较低或流动性需求较高的客户。' },
  { id: 'KB-10', topic: '产品', text: '组合再平衡策略通过定期调整资产权重控制风险敞口，适合长期持有的客户。' },
  { id: 'KB-11', topic: '产品', text: '定投可以摊薄成本，但不改变产品的风险属性，也不保证最终收益为正。' },
  { id: 'KB-12', topic: '合规', text: '禁止使用立即买入、马上操作、限时抢购等诱导性紧迫表达影响客户决策。' },
  { id: 'KB-13', topic: '合规', text: '禁止代替客户做出交易决策，客户应在充分知悉信息后自主决定。' },
  { id: 'KB-14', topic: '合规', text: '不得使用内幕信息或未公开重大信息向客户提供投资建议。' },
  { id: 'KB-15', topic: '合规', text: '向客户介绍产品时必须揭示风险，不得只强调收益或选择性披露信息。' },
  { id: 'KB-16', topic: '合规', text: '沟通中不得泄露客户隐私信息，包括资产规模、持仓明细与联系方式。' },
  { id: 'KB-17', topic: '合规', text: '越级推荐指向风险等级不足的客户推荐更高风险等级的产品，属于适当性违规。' },
  { id: 'KB-18', topic: '合规', text: '不得贬低同业机构或产品，也不得使用最好、第一、稳赚等绝对化用语。' },
  { id: 'KB-19', topic: '流程', text: '高风险客户触达需具备相应权限的人员复核确认后方可执行。' },
  { id: 'KB-20', topic: '流程', text: '分群差异化沟通应先识别客户画像与风险等级，再匹配渠道、话术与触达节奏。' },
  { id: 'KB-21', topic: '流程', text: '投诉风险较高的客户应优先由人工坐席介入，并保留完整沟通记录用于复核。' },
  { id: 'KB-22', topic: '流程', text: '群体压力测试应固定随机种子，保证相同输入下结果可复现、可审计。' },
  { id: 'KB-23', topic: '流程', text: '客户流失预警应结合交易频率、服务记录与情绪状态，单一指标不足以支撑判断。' },
  { id: 'KB-24', topic: '流程', text: '市场冲击越大、持续时间越长，客户恐慌与赎回倾向的峰值出现得越晚且衰减越慢。' },
];

const cjk = /[\u4e00-\u9fff]/;

/** 中文按字符二元组切分，英文与数字按词切分，避免引入分词依赖。 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.toLowerCase().replace(/[^\u4e00-\u9fff\w]+/g, ' ').trim();
  for (const chunk of normalized.split(/\s+/).filter(Boolean)) {
    if (cjk.test(chunk)) {
      const chars = Array.from(chunk);
      if (chars.length === 1) tokens.push(chars[0]);
      for (let index = 0; index + 1 < chars.length; index += 1) tokens.push(chars[index] + chars[index + 1]);
    } else {
      tokens.push(chunk);
    }
  }
  return tokens;
}

export type RetrievedDoc = KnowledgeDoc & { score: number };

/**
 * BM25 检索：k1/b 采用通用默认值，返回与查询最相关的若干条内部知识。
 */
export function bm25Search(query: string, limit = 3, corpus: KnowledgeDoc[] = knowledgeCorpus): RetrievedDoc[] {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) return [];
  const documents = corpus.map((doc) => tokenize(doc.text));
  const averageLength = documents.reduce((sum, tokens) => sum + tokens.length, 0) / Math.max(1, documents.length);
  const k1 = 1.5;
  const b = 0.75;
  const scored = corpus.map((doc, index) => {
    const tokens = documents[index];
    const length = tokens.length;
    let score = 0;
    for (const token of queryTokens) {
      const frequency = tokens.filter((item) => item === token).length;
      if (frequency === 0) continue;
      const containing = documents.filter((items) => items.includes(token)).length;
      const idf = Math.log(1 + (documents.length - containing + 0.5) / (containing + 0.5));
      score += idf * (frequency * (k1 + 1)) / (frequency + k1 * (1 - b + (b * length) / Math.max(1, averageLength)));
    }
    return { ...doc, score: Number(score.toFixed(4)) };
  });
  return scored.filter((doc) => doc.score > 0).sort((left, right) => right.score - left.score).slice(0, limit);
}
