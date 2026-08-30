const forbidden = [
  { pattern: /保证收益|稳赚|保本高收益/, rule: 'AD-CONTENT-07', severity: 'blocked' },
  { pattern: /立即清仓|全部卖出|满仓/, rule: 'SUITABILITY-03', severity: 'review' },
  { pattern: /内部消息|内幕/, rule: 'MARKET-CONDUCT-02', severity: 'blocked' },
];

export async function POST(request: Request) {
  const body = (await request.json()) as { text?: string };
  const text = body.text?.trim() ?? '';
  const findings = forbidden
    .filter(({ pattern }) => pattern.test(text))
    .map(({ rule, severity }) => ({ rule, severity, evidence: '命中禁止性或高风险表达' }));
  return Response.json({ passed: !findings.some((item) => item.severity === 'blocked'), findings });
}
