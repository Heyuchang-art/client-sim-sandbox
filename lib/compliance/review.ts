import {
  RULE_VERSION,
  checkSuitability,
  complianceRules,
  effectiveSeverity,
  isNegated,
  severityLabels,
  type ComplianceRule,
  type ComplianceScope,
  type ComplianceSeverity,
  type RiskLevel,
} from './rules';

export type { ComplianceFinding } from './types';
import type { ComplianceFinding } from './types';

export type ComplianceHit = {
  rule: ComplianceRule;
  severity: ComplianceSeverity;
  negated: boolean;
  matchedText: string;
  index: number;
  length: number;
  excerpt: string;
};

export type ComplianceCandidate = {
  label: string;
  text: string;
  scope: ComplianceScope;
  /** 命中阻断级规则时实际采用的合规改写文本；未提供则原始文本被整体弃用。 */
  compliantAlternative?: string;
};

export type ComplianceReview = {
  findings: ComplianceFinding[];
  blocked: boolean;
  effectiveTexts: string[];
  ruleVersion: string;
};

function sentenceExcerpt(text: string, index: number, length: number) {
  if (index < 0) return '';
  const start = Math.max(0, text.lastIndexOf('。', index) + 1, text.lastIndexOf('\n', index) + 1);
  let end = text.length;
  for (const breaker of ['。', '\n']) {
    const position = text.indexOf(breaker, index + length);
    if (position >= 0 && position < end) end = position;
  }
  const sentence = text.slice(start, Math.min(text.length, end + 1)).trim();
  return sentence.length > 80 ? `${sentence.slice(0, 78)}…` : sentence;
}

export function scanText(text: string, scope: ComplianceScope): ComplianceHit[] {
  const hits: ComplianceHit[] = [];
  for (const rule of complianceRules) {
    if (rule.scope !== scope) continue;
    if (rule.kind === 'required') {
      if (!rule.pattern.test(text)) {
        hits.push({
          rule,
          severity: rule.severity,
          negated: false,
          matchedText: '',
          index: -1,
          length: 0,
          excerpt: '',
        });
      }
      continue;
    }
    const global = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = global.exec(text)) !== null) {
      const matchedText = match[0];
      const negated = rule.negationAware && isNegated(text, match.index, matchedText.length);
      hits.push({
        rule,
        severity: effectiveSeverity(rule, negated),
        negated,
        matchedText,
        index: match.index,
        length: matchedText.length,
        excerpt: sentenceExcerpt(text, match.index, matchedText.length),
      });
      if (matchedText.length === 0) global.lastIndex += 1;
    }
  }
  return hits;
}

function statusFor(rule: ComplianceRule, severity: ComplianceSeverity): '已拦截' | '待审批' | '通过' {
  if (severity === 'block') return '已拦截';
  if (severity === 'review') return '待审批';
  return rule.kind === 'required' ? '待审批' : '通过';
}

function detailFor(hit: ComplianceHit, label: string) {
  if (hit.index < 0) return `${label}：${hit.rule.advice}`;
  if (hit.negated) return `${label}：命中「${hit.matchedText}」，处于否定或免责语境，按提示记录。`;
  return `${label}：命中「${hit.matchedText}」，${hit.rule.advice}`;
}

export function reviewCandidates(strategy: string, candidates: ComplianceCandidate[]): ComplianceReview {
  const findings: ComplianceFinding[] = [];
  const effectiveTexts: string[] = [];
  const seenRules = new Set<string>();
  // 同一规则可能在“草稿被拦截”和“合规话术处于否定语境”两种情况下分别命中，按 规则+严重度 去重以便完整留痕。
  let blocked = false;

  for (const candidate of candidates) {
    const hits = scanText(candidate.text, candidate.scope);
    const blocking = hits.some((hit) => hit.severity === 'block');
    if (blocking) blocked = true;
    effectiveTexts.push(blocking ? candidate.compliantAlternative ?? candidate.text : candidate.text);

    for (const hit of hits) {
      const dedupeKey = `${hit.rule.id}|${hit.severity}`;
      if (seenRules.has(dedupeKey)) continue;
      seenRules.add(dedupeKey);
      findings.push({
        id: `${strategy}-${hit.rule.id}`,
        rule: hit.rule.id,
        title: hit.rule.title,
        severity: severityLabels[hit.severity],
        strategy,
        detail: detailFor(hit, candidate.label),
        evidence: hit.matchedText,
        excerpt: hit.excerpt,
        index: hit.index,
        length: hit.length,
        status: statusFor(hit.rule, hit.severity),
        remediation: hit.severity === 'block' ? '已切换为合规改写文本后继续执行。' : undefined,
        ruleVersion: RULE_VERSION,
      });
    }
  }

  return { findings, blocked, effectiveTexts, ruleVersion: RULE_VERSION };
}

export function suitabilityFinding(
  strategy: string,
  customerLevel: RiskLevel,
  product: string,
  productRisk: number,
): ComplianceFinding | null {
  const verdict = checkSuitability(customerLevel, productRisk);
  if (verdict === 'allow') return null;
  const severity: ComplianceSeverity = verdict === 'block' ? 'block' : 'review';
  return {
    id: `${strategy}-SUITABILITY-MATRIX`,
    rule: verdict === 'block' ? 'SUITABILITY-MATRIX-01' : 'SUITABILITY-MATRIX-02',
    title: verdict === 'block' ? '产品风险超越客户承受等级' : '产品风险高于客户等级一档',
    severity: severityLabels[severity],
    strategy,
    detail:
      verdict === 'block'
        ? `${customerLevel} 客户不应触达风险等级 ${productRisk} 的「${product}」，已阻断该类触达。`
        : `${customerLevel} 客户触达风险等级 ${productRisk} 的「${product}」需合规复核。`,
    evidence: `${customerLevel} × ${product}(R${productRisk})`,
    excerpt: '',
    index: -1,
    length: 0,
    status: verdict === 'block' ? '已拦截' : '待审批',
    ruleVersion: RULE_VERSION,
  };
}

export function checkText(
  text: string,
  options: { scope: ComplianceScope; label?: string; strategy?: string } = { scope: 'message' },
): { passed: boolean; findings: ComplianceFinding[]; ruleVersion: string } {
  const label = options.label ?? '待检文本';
  const strategy = options.strategy ?? 'manual-check';
  const hits = scanText(text, options.scope);
  const findings: ComplianceFinding[] = hits.map((hit) => ({
    id: `${strategy}-${hit.rule.id}`,
    rule: hit.rule.id,
    title: hit.rule.title,
    severity: severityLabels[hit.severity],
    strategy,
    detail: detailFor(hit, label),
    evidence: hit.matchedText,
    excerpt: hit.excerpt,
    index: hit.index,
    length: hit.length,
    status: statusFor(hit.rule, hit.severity),
    ruleVersion: RULE_VERSION,
  }));
  return { passed: !findings.some((finding) => finding.severity === '阻断'), findings, ruleVersion: RULE_VERSION };
}

export { RULE_VERSION, checkSuitability, severityLabels };
export type { RiskLevel };
