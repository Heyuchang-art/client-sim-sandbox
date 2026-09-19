import { describe, expect, it } from 'vitest';
import { defaultScenario } from '../scenario';
import { answerAsk, parseAskQuery } from './ask';

const scenario = { ...defaultScenario, marketShock: -0.3, durationHours: 48 };

describe('客户数据问答 · 解析', () => {
  it('识别产品筛选与计数意图', () => {
    const query = parseAskQuery('持有科技成长组合的客户有多少')!;
    expect(query.metric).toBe('客户数');
    expect(query.dimension).toBe('不分组');
    expect(query.filters).toEqual([{ field: '产品', op: '=', value: '科技成长组合', source: '科技成长组合' }]);
  });

  it('识别回撤阈值与风险优先级', () => {
    const query = parseAskQuery('回撤超过 20% 的高风险客户有多少名')!;
    expect(query.filters.map((item) => item.field).sort()).toEqual(['优先级', '回撤']);
    const drawdown = query.filters.find((item) => item.field === '回撤')!;
    expect(drawdown.op).toBe('>=');
    expect(drawdown.value).toBe(20);
    expect(query.filters.find((item) => item.field === '优先级')!.value).toBe('高');
  });

  it('识别分组维度', () => {
    expect(parseAskQuery('按原型统计平均恐慌')!.dimension).toBe('原型');
    expect(parseAskQuery('按风险等级统计平均卖出倾向')!.dimension).toBe('风险等级');
    expect(parseAskQuery('按产品统计客户数')!.dimension).toBe('产品');
  });

  it('「最需要优先联系」按峰值风险排序，而不是回撤', () => {
    const query = parseAskQuery('哪 10 位客户最需要优先联系')!;
    expect(query.orderBy).toBe('风险');
    expect(query.limit).toBe(10);
  });

  it('明确说回撤时才按回撤排序', () => {
    expect(parseAskQuery('回撤最高的 5 位客户')!.orderBy).toBe('回撤');
  });

  it('与业务无关的问题不硬猜', () => {
    expect(parseAskQuery('今天天气怎么样')).toBeNull();
    expect(parseAskQuery('')).toBeNull();
  });
});

describe('客户数据问答 · 作答', () => {
  it('计数类问题给出准确人数，且与客户池规模一致', () => {
    const answer = answerAsk('持有科技成长组合的客户有多少', scenario);
    expect(answer.understood).toBe(true);
    expect(answer.matched).toBeGreaterThan(0);
    expect(answer.matched).toBeLessThanOrEqual(scenario.customerCount);
    expect(answer.answer).toContain(String(answer.matched));
  });

  it('概率类指标按百分比显示，不出现 0.3% 这类错位', () => {
    const answer = answerAsk('按原型统计平均恐慌', scenario);
    for (const row of answer.rows) {
      expect(row.value).toBeGreaterThan(0);
      expect(row.value).toBeLessThanOrEqual(1);
      expect(answer.answer).toContain((row.value * 100).toFixed(1) + '%');
    }
  });

  it('分组统计的合计不超过总人数', () => {
    const answer = answerAsk('按产品统计客户数', scenario);
    const total = answer.rows.reduce((sum, row) => sum + row.value, 0);
    expect(total).toBe(answer.matched);
  });

  it('排序结果与展示字段一致：按峰值风险排就显示峰值风险', () => {
    const answer = answerAsk('哪 10 位客户最需要优先联系', scenario);
    expect(answer.customers.length).toBe(10);
    // 显示的是峰值风险，而不是别的字段，否则会看起来像乱序
    expect(answer.answer).toContain('峰值风险');
    const shown = [...answer.answer.matchAll(/峰值风险 (\d+)%/g)].map((match) => Number(match[1]));
    for (let index = 1; index < shown.length; index += 1) {
      expect(shown[index]).toBeLessThanOrEqual(shown[index - 1]);
    }
  });

  it('无法理解时返回可操作的提示，而不是空结果', () => {
    const answer = answerAsk('今天天气怎么样', scenario);
    expect(answer.understood).toBe(false);
    expect(answer.reason).toBeTruthy();
    expect(answer.reason).toContain('例如');
  });

  it('同一问题在同一场景下可复现', () => {
    const first = answerAsk('按原型统计平均恐慌', scenario);
    const second = answerAsk('按原型统计平均恐慌', scenario);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
