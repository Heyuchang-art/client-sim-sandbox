import { RULE_VERSION, checkText, suitabilityFinding } from '../../../../lib/compliance';
import { riskLevels, type ComplianceScope, type RiskLevel } from '../../../../lib/compliance/rules';

export async function POST(request: Request) {
  const body = (await request.json()) as {
    text?: string;
    scope?: ComplianceScope;
    strategy?: string;
    customerRiskLevel?: RiskLevel;
    product?: string;
    productRisk?: number;
  };
  const text = body.text?.trim() ?? '';
  if (!text) return Response.json({ error: '待检文本不能为空。' }, { status: 400 });
  const scope: ComplianceScope = body.scope === 'strategy' ? 'strategy' : 'message';
  const verdict = checkText(text, { scope, strategy: body.strategy ?? 'manual-check' });

  const findings = [...verdict.findings];
  if (body.customerRiskLevel && riskLevels.includes(body.customerRiskLevel) && typeof body.productRisk === 'number') {
    const suitability = suitabilityFinding(
      body.strategy ?? 'manual-check',
      body.customerRiskLevel,
      body.product ?? '未命名产品',
      body.productRisk,
    );
    if (suitability) findings.push(suitability);
  }

  return Response.json({
    passed: !findings.some((finding) => finding.severity === '阻断'),
    findings,
    ruleVersion: RULE_VERSION,
    checkedScope: scope,
  });
}
