export type ComplianceFinding = {
  id: string;
  rule: string;
  title: string;
  severity: '阻断' | '警告' | '提示';
  strategy: string;
  detail: string;
  evidence: string;
  excerpt: string;
  index: number;
  length: number;
  status: '已拦截' | '待审批' | '通过';
  remediation?: string;
  ruleVersion: string;
};
