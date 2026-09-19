/**
 * 规则路径（确定性规划器）的行为测试。
 *
 * 这批用例针对的是「静默答错」这一最危险的行为：识别不到条件时给出一个看似合理的数字，
 * 比明确拒答更糟。因此每条用例都断言 SQL 里真的出现了对应条件，而不是只断言「不报错」。
 */
import { describe, expect, it } from 'vitest';
import { planAnalyticsQuery } from './planner';

function sqlOf(question: string) {
  return planAnalyticsQuery(question)?.sql ?? '';
}

describe('指标与维度识别', () => {
  it('户均要把合计真的除以客户数', () => {
    const sql = sqlOf('户均持仓市值是多少');
    expect(sql).toContain('/ COUNT(DISTINCT c.cust_id)');
    expect(sql).toContain('SUM(h.market_value)');
  });

  it('按产品类型分组统计持仓市值', () => {
    const sql = sqlOf('各产品类型的持仓市值');
    expect(sql).toContain('p.prod_type');
    expect(sql).toContain('GROUP BY p.prod_type');
  });

  it('前 N 名要按指标排序而不是按分组名排序', () => {
    const sql = sqlOf('各客户经理名下的客户数（前 5 名）');
    expect(sql).toContain('ORDER BY 客户数 DESC');
    expect(sql.trimEnd().endsWith('LIMIT 5')).toBe(true);
  });
});

describe('条件不能被静默忽略', () => {
  it('持有 N 只以上要走 HAVING，而不是被丢掉', () => {
    const sql = sqlOf('持有 3 只以上产品的客户有多少人');
    expect(sql).toContain('HAVING COUNT(*) >= 3');
  });

  it('开户年限要真的换算成日期条件', () => {
    const sql = sqlOf('开户超过 10 年的客户有多少');
    expect(sql).toContain("date('2026-09-18', '-10 year')");
  });

  it('两个明细条件要同时生效', () => {
    const sql = sqlOf('近 90 日有交易且有资金流入的客户有多少人');
    expect(sql).toContain('FROM cust_trade');
    expect(sql).toContain("flow_type = '流入'");
    expect(sql.match(/date\('2026-09-18', '-90 day'\)/g)?.length).toBe(2);
  });
});

describe('超出元数据覆盖面时必须拒答', () => {
  it('域外主题（投诉、满意度）明确拒答', () => {
    expect(planAnalyticsQuery('有多少客户投诉了')).toBeNull();
    expect(planAnalyticsQuery('客户满意度是多少')).toBeNull();
    expect(planAnalyticsQuery('近一周的投诉客户有多少')).toBeNull();
  });

  it('没有可用指标且不是在问客户数量时拒答', () => {
    expect(planAnalyticsQuery('帮我看看大户')).toBeNull();
    expect(planAnalyticsQuery('张三的持仓是多少')).toBeNull();
  });

  it('正常的客户数量提问仍然作答', () => {
    expect(sqlOf('我们有多少位客户')).toContain('客户数');
    expect(sqlOf('沉默客户有多少人')).toContain('NOT IN');
  });
});