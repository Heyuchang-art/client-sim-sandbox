/**
 * 安全围栏负例测试。
 *
 * 这批用例专门覆盖「审计发现的漏拦与误拦」，每一条都对应一个真实的绕过手法或误报场景：
 * 跨表幻觉列、CTE、子查询 LIMIT 顶替、结果层荒谬值、函数白名单过窄、字符串里的注释符。
 * 没有这批负例，围栏的强度就只能靠「看起来对」来判断。
 */
import { describe, expect, it } from 'vitest';
import { inspectMetrics, inspectResult, inspectSql } from './guardrail';

function rulesOf(sql: string) {
  return inspectSql(sql).findings.map((finding) => finding.rule);
}

describe('语义层：按表校验列名', () => {
  it('拦下跨表的幻觉字段（无表前缀写法）', () => {
    const check = inspectSql('SELECT gender, market_value FROM cust_info LIMIT 10');
    expect(check.passed).toBe(false);
    expect(rulesOf('SELECT gender, market_value FROM cust_info LIMIT 10')).toContain('G-SEM-06');
  });

  it('拦下跨表的幻觉字段（带表前缀写法）', () => {
    const sql = 'SELECT c.cust_id, c.market_value FROM cust_info c LIMIT 10';
    expect(inspectSql(sql).passed).toBe(false);
    expect(rulesOf(sql)).toContain('G-SEM-05');
  });

  it('同一字段在正确的表上应当放行', () => {
    const check = inspectSql('SELECT h.market_value FROM cust_info c JOIN cust_holding h ON c.cust_id = h.cust_id LIMIT 10');
    expect(check.passed).toBe(true);
  });

  it('拦下未知的表别名', () => {
    const check = inspectSql('SELECT x.cust_id FROM cust_info c LIMIT 10');
    expect(check.passed).toBe(false);
  });
});

describe('结构层：CTE 与行数上限', () => {
  it('WITH 查询不应被误拦（提示词允许模型使用 CTE）', () => {
    const sql = 'WITH x AS (SELECT cust_id FROM cust_info) SELECT COUNT(*) AS n FROM x LIMIT 5';
    const check = inspectSql(sql);
    expect(check.passed).toBe(true);
  });

  it('子查询里的 LIMIT 不能顶替外层的行数上限', () => {
    const sql = 'SELECT cust_id FROM cust_info WHERE cust_id IN (SELECT cust_id FROM cust_trade LIMIT 5)';
    const check = inspectSql(sql);
    expect(check.passed).toBe(true);
    expect(rulesOf(sql)).toContain('G-STRUCT-06');
    expect(check.normalizedSql.trimEnd().endsWith('LIMIT 1000')).toBe(true);
  });

  it('字符串字面量里的 -- 不应被当成注释', () => {
    const check = inspectSql("SELECT cust_id FROM cust_info WHERE cust_name LIKE '%--%' LIMIT 5");
    expect(check.passed).toBe(true);
  });
});

describe('语义层：函数白名单', () => {
  it('常用字符串与空值函数不应被误拦', () => {
    const sql = "SELECT UPPER(cust_name) AS n, IFNULL(branch, '') AS b, LENGTH(cust_name) AS l FROM cust_info LIMIT 5";
    expect(inspectSql(sql).passed).toBe(true);
  });

  it('REPLACE 作为函数不应触发「禁止写操作」', () => {
    const sql = "SELECT REPLACE(cust_name, 'a', 'b') AS n FROM cust_info LIMIT 5";
    const check = inspectSql(sql);
    expect(check.passed).toBe(true);
    expect(check.findings.map((finding) => finding.rule)).not.toContain('G-STRUCT-03');
  });

  it('覆盖 group_concat 与日期函数', () => {
    const sql = "SELECT GROUP_CONCAT(cust_id) AS ids FROM cust_info WHERE open_date <= DATE('2026-09-18') LIMIT 5";
    expect(inspectSql(sql).passed).toBe(true);
  });
});

describe('语义层：指标合法性', () => {
  it('已登记的指标名称与中文名都放行', () => {
    expect(inspectMetrics(['customer_count', '客户数', '持仓市值'])).toEqual([]);
  });

  it('未登记的指标一律拦截', () => {
    const findings = inspectMetrics(['客户满意度', 'NPS']);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('G-SEM-04');
    expect(findings[0].disposition).toBe('拦截');
  });
});

describe('结果层：合理性检查', () => {
  it('客户数超过全量客户时给出提醒', () => {
    const findings = inspectResult(['客户数'], [{ 客户数: 5000 }], { customerCount: 1000 });
    expect(findings.map((finding) => finding.rule)).toContain('G-RES-07');
  });

  it('金额量级异常时给出提醒', () => {
    const findings = inspectResult(['持仓市值'], [{ 持仓市值: 1e15 }]);
    expect(findings.map((finding) => finding.rule)).toContain('G-RES-06');
  });

  it('正常结果不产生多余提醒', () => {
    expect(inspectResult(['客户数'], [{ 客户数: 800 }], { customerCount: 1000 })).toEqual([]);
  });

  it('空结果与超量行数仍按原口径提醒', () => {
    expect(inspectResult(['客户数'], [], { customerCount: 1000 }).map((finding) => finding.rule)).toContain('G-RES-03');
  });
});