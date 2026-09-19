/**
 * 客户数据问答：把自然语言问题解析为受控的结构化查询，在客户数据上执行并给出可解释的答案。
 *
 * 设计取舍：不生成自由 SQL。可问的指标、维度与筛选字段都走白名单，
 * 解析结果先结构化、再校验，然后才执行。这样做有三个好处：
 * 一是安全，用户问什么都无法触达白名单之外的字段或写操作；
 * 二是可审计，每一次问答都能把「我理解成了什么查询」原样记下来；
 * 三是可复现，同一问题与同一场景必然得到同一答案。
 */
import { runSimulation, type Customer } from '../simulation';
import { defaultScenario, type ScenarioConfig } from '../scenario';

export type AskMetric = '客户数' | '平均回撤' | '平均恐慌' | '平均卖出倾向' | '平均流失倾向' | '平均投诉倾向';
export type AskDimension = '不分组' | '原型' | '风险等级' | '产品' | '优先级';

export type AskFilter = {
  field: '原型' | '风险等级' | '产品' | '优先级' | '回撤' | '恐慌' | '流失倾向';
  op: '=' | '>=' | '<=';
  value: string | number;
  /** 命中的原文片段，便于界面上说明「依据是问题里的哪一句」 */
  source: string;
};

export type AskQuery = {
  metric: AskMetric;
  dimension: AskDimension;
  filters: AskFilter[];
  orderBy: '风险' | '回撤' | '恐慌' | '流失倾向' | null;
  orderDir: '升序' | '降序';
  limit: number | null;
};

export type AskRow = { label: string; value: number };

export type AskAnswer = {
  /** 是否成功理解了这个提问 */
  understood: boolean;
  /** 无法理解时给出的说明 */
  reason: string | null;
  query: AskQuery;
  /** 命中的客户数量 */
  matched: number;
  /** 分组统计结果；不分组时只有一行 */
  rows: AskRow[];
  /** 明细名单（受 limit 限制） */
  customers: Array<{
    id: string;
    name: string;
    archetype: string;
    riskLevel: string;
    product: string;
    drawdown: number;
    panic: number;
    churn: number;
    priority: string;
  }>;
  /** 自然语言答案 */
  answer: string;
  /** 我理解成的问题，用于让用户核对 */
  interpreted: string;
};

/** 可提问的示例，界面上直接给出，降低用户的上手成本。 */
export const askExamples = [
  '回撤超过 20% 的高风险客户有多少名',
  '按原型统计平均恐慌',
  '持有新能源主题基金的客户平均流失倾向是多少',
  '哪 10 位客户最需要优先联系',
  '按产品统计客户数',
];

const metrics: Array<{ keys: string[]; metric: AskMetric; of: (customer: Customer) => number; percent: boolean }> = [
  { keys: ['平均回撤', '平均亏损', '平均跌幅'], metric: '平均回撤', of: (customer) => customer.drawdown, percent: true },
  { keys: ['平均恐慌', '恐慌平均', '平均恐慌值'], metric: '平均恐慌', of: (customer) => customer.panic, percent: true },
  { keys: ['平均卖出', '卖出倾向平均'], metric: '平均卖出倾向', of: (customer) => customer.sell, percent: true },
  { keys: ['平均流失', '流失倾向平均', '流失风险平均'], metric: '平均流失倾向', of: (customer) => customer.churn, percent: true },
  { keys: ['平均投诉', '投诉倾向平均'], metric: '平均投诉倾向', of: (customer) => customer.complaint, percent: true },
];

const dimensions: Array<{ keys: string[]; dimension: AskDimension; of: (customer: Customer) => string }> = [
  { keys: ['按原型', '各类原型', '每个原型', '分原型'], dimension: '原型', of: (customer) => customer.archetype },
  { keys: ['按风险等级', '各风险等级', '分风险等级'], dimension: '风险等级', of: (customer) => customer.riskLevel },
  { keys: ['按产品', '各产品', '分产品'], dimension: '产品', of: (customer) => customer.product },
  { keys: ['按优先级', '各优先级', '分优先级'], dimension: '优先级', of: (customer) => customer.priority },
];

const archetypeNames = ['稳健守成型', '长期成长型', '进取交易型', '高频敏感型', '沉默流失型'];
const products = ['科技成长组合', '量化增强产品', '新能源主题基金', '红利低波组合'];

function numberAfter(text: string, keys: string[]): { value: number; source: string } | null {
  for (const key of keys) {
    const pattern = new RegExp(key + '[^0-9]{0,6}([0-9]+(?:\\.[0-9]+)?)\\s*%?');
    const match = pattern.exec(text);
    if (match) return { value: Number(match[1]), source: match[0] };
  }
  return null;
}

function containsAny(text: string, keys: string[]) {
  return keys.find((key) => text.includes(key)) ?? null;
}

/** 把自然语言问题解析为受控查询；解析不出来时返回 null，由上层给出可提问的示例。 */
export function parseAskQuery(question: string): AskQuery | null {
  const text = question.trim();
  if (!text) return null;

  const metricHit = metrics.find((item) => containsAny(text, item.keys));
  const asksCount = /多少|几名|几户|数量|人数|几个|客户数|统计|分布|占比/.test(text);
  const wantsRanking = /最需要|最危险|优先联系|最该|排在前|最高|最严重|名单/.test(text);
  if (!metricHit && !asksCount && !wantsRanking) return null;
  const metric: AskMetric = metricHit ? metricHit.metric : '客户数';

  const dimension: AskDimension = dimensions.find((item) => containsAny(text, item.keys))?.dimension ?? '不分组';

  const filters: AskFilter[] = [];

  const productHit = containsAny(text, products);
  if (productHit) filters.push({ field: '产品', op: '=', value: productHit, source: productHit });

  const archetypeHit = containsAny(text, archetypeNames);
  if (archetypeHit) filters.push({ field: '原型', op: '=', value: archetypeHit, source: archetypeHit });

  const levelMatch = /(?:风险等级|等级)\s*(C[1-5])/.exec(text) ?? /\b(C[1-5])\b/.exec(text);
  if (levelMatch) filters.push({ field: '风险等级', op: '=', value: levelMatch[1], source: levelMatch[0] });

  const priorityHit = containsAny(text, ['高风险', '中风险', '低风险']);
  if (priorityHit) filters.push({ field: '优先级', op: '=', value: priorityHit[0], source: priorityHit });

  const drawdownAbove = numberAfter(text, ['回撤超过', '回撤高于', '回撤大于', '回撤不低于', '回撤至少']);
  if (drawdownAbove) filters.push({ field: '回撤', op: '>=', value: drawdownAbove.value, source: drawdownAbove.source });
  else {
    const drawdownBelow = numberAfter(text, ['回撤低于', '回撤小于', '回撤不超过']);
    if (drawdownBelow) filters.push({ field: '回撤', op: '<=', value: drawdownBelow.value, source: drawdownBelow.source });
  }

  const panicAbove = numberAfter(text, ['恐慌超过', '恐慌高于', '恐慌大于']);
  if (panicAbove) filters.push({ field: '恐慌', op: '>=', value: panicAbove.value / 100, source: panicAbove.source });

  const churnAbove = numberAfter(text, ['流失超过', '流失高于', '流失大于']);
  if (churnAbove) filters.push({ field: '流失倾向', op: '>=', value: churnAbove.value / 100, source: churnAbove.source });

  // 「最需要优先联系」按峰值风险排，与产品里的干预队列口径一致；只有明确说回撤时才按回撤排。
  const orderBy: AskQuery['orderBy'] = wantsRanking
    ? (/恐慌/.test(text) ? '恐慌' : /流失/.test(text) ? '流失倾向' : /回撤/.test(text) ? '回撤' : '风险')
    : null;

  const limitMatch = /(?:前|头|最)\s*([0-9]+)\s*(?:位|名|个|户)/.exec(text) ?? /([0-9]+)\s*(?:位|名)\s*客户/.exec(text);
  const limit = limitMatch ? Math.min(50, Number(limitMatch[1])) : wantsRanking && !limitMatch ? 10 : null;

  return { metric, dimension, filters, orderBy, orderDir: '降序', limit };
}

function applyFilters(customers: Customer[], filters: AskFilter[]) {
  return customers.filter((customer) =>
    filters.every((filter) => {
      switch (filter.field) {
        case '产品': return customer.product === filter.value;
        case '原型': return customer.archetype === filter.value;
        case '风险等级': return customer.riskLevel === filter.value;
        case '优先级': return customer.priority === filter.value;
        case '回撤': return filter.op === '>=' ? customer.drawdown >= Number(filter.value) : customer.drawdown <= Number(filter.value);
        case '恐慌': return customer.panic >= Number(filter.value);
        case '流失倾向': return customer.churn >= Number(filter.value);
        default: return true;
      }
    }),
  );
}

function describeFilters(filters: AskFilter[]) {
  if (filters.length === 0) return '全部客户';
  return filters.map((filter) => {
    if (filter.field === '回撤') return `回撤${filter.op === '>=' ? '不低于' : '不高于'} ${filter.value}%`;
    if (filter.field === '恐慌') return `恐慌不低于 ${(Number(filter.value) * 100).toFixed(0)}%`;
    if (filter.field === '流失倾向') return `流失倾向不低于 ${(Number(filter.value) * 100).toFixed(0)}%`;
    if (filter.field === '优先级') return `${filter.value}优先级`;
    if (filter.field === '原型') return `客户画像为${filter.value}`;
    return `${filter.field}为${filter.value}`;
  }).join('、');
}

export function answerAsk(question: string, scenario: ScenarioConfig = defaultScenario): AskAnswer {
  const query = parseAskQuery(question);
  if (!query) {
    return {
      understood: false,
      reason: '没听清这个问题。可以说得更具体一些，例如「持有科技成长组合、回撤超过 20% 的高风险客户有多少」。',
      query: { metric: '客户数', dimension: '不分组', filters: [], orderBy: null, orderDir: '降序', limit: null },
      matched: 0,
      rows: [],
      customers: [],
      answer: '',
      interpreted: '',
    };
  }

  const result = runSimulation(scenario);
  // 与界面同口径：问答针对当前推荐方案下的客户状态。
  const all = applyFilters(result.customers, query.filters);

  const metricDef = metrics.find((item) => item.metric === query.metric);
  const valueOf = (list: Customer[]) => {
    if (!metricDef) return list.length;
    if (list.length === 0) return 0;
    return list.reduce((sum, customer) => sum + metricDef.of(customer), 0) / list.length;
  };

  let rows: AskRow[] = [];
  if (query.dimension === '不分组') {
    rows = [{ label: '全部', value: valueOf(all) }];
  } else {
    const dimensionDef = dimensions.find((item) => item.dimension === query.dimension)!;
    const groups = new Map<string, Customer[]>();
    all.forEach((customer) => {
      const key = dimensionDef.of(customer);
      groups.set(key, [...(groups.get(key) ?? []), customer]);
    });
    rows = [...groups.entries()]
      .map(([label, list]) => ({ label, value: valueOf(list) }))
      .sort((left, right) => right.value - left.value);
  }

  const sorted = query.orderBy
    ? [...all].sort((left, right) =>
        query.orderBy === '恐慌' ? right.panic - left.panic
          : query.orderBy === '流失倾向' ? right.churn - left.churn
            : query.orderBy === '回撤' ? right.drawdown - left.drawdown
              : right.peakRisk - left.peakRisk)
    : all;
  const listed = query.limit ? sorted.slice(0, query.limit) : sorted.slice(0, 20);

  // 回撤本身以百分比为单位；恐慌、卖出、流失、投诉是 0—1 的概率值，显示时需要乘 100。
  const fmt = (value: number) =>
    !metricDef || metricDef.metric === '客户数'
      ? `${value} 名`
      : metricDef.metric === '平均回撤'
        ? `${value.toFixed(1)}%`
        : `${(value * 100).toFixed(1)}%`;

  const scope = query.filters.length === 0 ? '全部客户中' : `${describeFilters(query.filters)} 的客户中`;
  const parts: string[] = [];
  if (query.dimension !== '不分组' && rows.length > 0) {
    parts.push(`${scope}共 ${all.length} 名。${query.metric}按${query.dimension}分组为：` + rows.map((row) => `${row.label} ${fmt(row.value)}`).join('，') + '。');
  } else if (metricDef) {
    parts.push(`${scope}共 ${all.length} 名，${query.metric}为 ${fmt(rows[0]?.value ?? 0)}。`);
  } else if (!(query.orderBy && query.filters.length === 0)) {
    parts.push(`${scope}共 ${all.length} 名。`);
  }
  // 名单里显示的必须是排序依据的那个字段，否则「按风险排序却显示回撤」会看起来像乱序。
  const orderLabel = query.orderBy === '风险' ? '峰值风险' : query.orderBy;
  const orderValueOf = (customer: Customer) => {
    if (query.orderBy === '恐慌') return `${(customer.panic * 100).toFixed(0)}%`;
    if (query.orderBy === '流失倾向') return `${(customer.churn * 100).toFixed(0)}%`;
    if (query.orderBy === '回撤') return `${customer.drawdown}%`;
    return `${(customer.peakRisk * 100).toFixed(0)}%`;
  };
  if (query.orderBy && listed.length > 0) {
    parts.push(`按${orderLabel}从高到低，前 ${listed.length} 名是 ` + listed.slice(0, 5).map((customer) => `${customer.name}（${customer.id}，${orderLabel} ${orderValueOf(customer)}）`).join('、') + '。');
  }

  const interpreted = `${query.metric}｜${query.dimension}｜筛选：${describeFilters(query.filters)}${query.orderBy ? `｜按${query.orderBy}${query.orderDir}取前 ${query.limit ?? 10} 名` : ''}`;

  return {
    understood: true,
    reason: null,
    query,
    matched: all.length,
    rows,
    customers: listed.map((customer) => ({
      id: customer.id,
      name: customer.name,
      archetype: customer.archetype,
      riskLevel: customer.riskLevel,
      product: customer.product,
      drawdown: customer.drawdown,
      panic: Number(customer.panic.toFixed(4)),
      churn: Number(customer.churn.toFixed(4)),
      priority: customer.priority,
    })),
    answer: parts.join(''),
    interpreted,
  };
}
