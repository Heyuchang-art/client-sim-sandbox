import { describe, expect, it } from 'vitest';
import { analyticsColumnWhitelist, analyticsTables, analyticsDdl } from './schema';
import { analyticsMetrics, metadataPromptContext } from './metadata';
import { guardrailMaxRows, inspectResult, inspectSql } from './guardrail';

describe('元数据层', () => {
  it('九张表齐备，且每张表都有中文名与列说明', () => {
    expect(analyticsTables).toHaveLength(9);
    for (const table of analyticsTables) {
      expect(table.label.length).toBeGreaterThan(0);
      expect(table.columns.length).toBeGreaterThan(3);
      for (const column of table.columns) {
        expect(column.label.length).toBeGreaterThan(0);
        expect(column.meaning.length).toBeGreaterThan(0);
      }
    }
  });

  it('建表语句与列白名单同源，不会两处各写一份', () => {
    const ddl = analyticsDdl();
    expect(ddl).toHaveLength(analyticsTables.length);
    analyticsTables.forEach((table, index) => {
      for (const column of table.columns) {
        expect(ddl[index]).toContain(column.name);
        expect(analyticsColumnWhitelist[table.name].has(column.name)).toBe(true);
      }
    });
  });

  it('每个指标都给出单位、依赖表与口径说明', () => {
    expect(analyticsMetrics.length).toBeGreaterThanOrEqual(10);
    for (const metric of analyticsMetrics) {
      expect(metric.definition.length).toBeGreaterThan(6);
      expect(metric.unit.length).toBeGreaterThan(0);
      expect(metric.tables.length).toBeGreaterThan(0);
    }
  });

  it('元数据摘要包含全部表名与指标名，供模型生成 SQL 使用', () => {
    const context = metadataPromptContext();
    for (const table of analyticsTables) expect(context).toContain(table.name);
    expect(context).toContain('净流入');
  });
});

describe('安全围栏 · 结构层', () => {
  it('只放行单条只读查询', () => {
    expect(inspectSql("SELECT cust_id FROM cust_info WHERE risk_level = 'C4' LIMIT 10").passed).toBe(true);
    expect(inspectSql('DELETE FROM cust_info WHERE 1=1').passed).toBe(false);
    expect(inspectSql('DROP TABLE cust_info').passed).toBe(false);
    expect(inspectSql('PRAGMA table_info(cust_info)').passed).toBe(false);
    expect(inspectSql('SELECT cust_id FROM cust_info; DROP TABLE cust_info').passed).toBe(false);
    expect(inspectSql('SELECT cust_id FROM cust_info -- 注释绕过').passed).toBe(false);
  });

  it('缺少 LIMIT 时自动补全并提醒，不会直接执行全表查询', () => {
    const check = inspectSql('SELECT cust_id FROM cust_info WHERE age > 50');
    expect(check.passed).toBe(true);
    expect(check.normalizedSql).toContain(`LIMIT ${guardrailMaxRows}`);
    expect(check.findings.some((finding) => finding.rule === 'G-STRUCT-05')).toBe(true);
  });
});

describe('安全围栏 · 语义层', () => {
  it('放行合法的多表关联与子查询', () => {
    expect(inspectSql("SELECT c.cust_id, SUM(h.market_value) AS v FROM cust_info c JOIN cust_holding h ON c.cust_id = h.cust_id GROUP BY c.cust_id LIMIT 50").passed).toBe(true);
    expect(inspectSql("SELECT COUNT(DISTINCT cust_id) FROM cust_trade WHERE cust_id IN (SELECT cust_id FROM cust_info WHERE risk_level = 'C5') LIMIT 10").passed).toBe(true);
  });

  it('拦截不存在的表', () => {
    const check = inspectSql('SELECT * FROM customer_master LIMIT 10');
    expect(check.passed).toBe(false);
    expect(check.findings.some((finding) => finding.rule === 'G-SEM-01')).toBe(true);
  });

  it('拦截模型臆造的字段', () => {
    const check = inspectSql('SELECT cust_id, wealth_score FROM cust_info LIMIT 10');
    expect(check.passed).toBe(false);
    expect(check.findings.some((finding) => finding.rule === 'G-SEM-03' && finding.excerpt.includes('WEALTH_SCORE'))).toBe(true);
  });

  it('所有拦截级 finding 都写清层次与规则，可写入审计', () => {
    const check = inspectSql('SELECT cust_id, wealth_score FROM cust_info LIMIT 10');
    for (const finding of check.findings) {
      expect(finding.layer).toBe('语义');
      expect(finding.rule).toMatch(/^G-/);
      expect(finding.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('安全围栏 · 结果层', () => {
  it('金额出现负值时提醒', () => {
    const findings = inspectResult(['cust_id', 'total_asset'], [{ cust_id: 'C-1001', total_asset: -1 }]);
    expect(findings.some((finding) => finding.rule === 'G-RES-04')).toBe(true);
  });

  it('比率超出 ±100% 时提醒', () => {
    const findings = inspectResult(['profit_ratio'], [{ profit_ratio: 3.2 }]);
    expect(findings.some((finding) => finding.rule === 'G-RES-05')).toBe(true);
  });

  it('空结果显式提示，而不是静默返回空表', () => {
    const findings = inspectResult(['cust_id'], []);
    expect(findings.some((finding) => finding.rule === 'G-RES-03')).toBe(true);
  });

  it('结果层只提醒不拦截，不改变查询结果本身', () => {
    const findings = inspectResult(['cust_id'], []);
    expect(findings.every((finding) => finding.disposition === '提醒')).toBe(true);
  });
});
