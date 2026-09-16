import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkSuitability } from './rules';
import { checkText, scanText } from './review';

type CorpusItem = { id: string; label: 'blocked' | 'review' | 'clean'; text: string };

const corpus: CorpusItem[] = readFileSync('evals/compliance-corpus.jsonl', 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as CorpusItem);

function blockedHits(text: string) {
  return scanText(text, 'message').filter((hit) => hit.rule.kind === 'forbidden' && hit.severity === 'block');
}

function reviewHits(text: string) {
  return scanText(text, 'message').filter((hit) => hit.rule.kind === 'forbidden' && hit.severity === 'review');
}

describe('合规语料回归', () => {
  const blockedSamples = corpus.filter((item) => item.label === 'blocked');
  const reviewSamples = corpus.filter((item) => item.label === 'review');
  const cleanSamples = corpus.filter((item) => item.label === 'clean');

  it('语料规模与标注分布满足评测要求', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(30);
    expect(blockedSamples.length).toBeGreaterThanOrEqual(10);
    expect(reviewSamples.length).toBeGreaterThanOrEqual(10);
    expect(cleanSamples.length).toBeGreaterThanOrEqual(10);
  });

  it('禁止性样例召回率不低于 95%', () => {
    const detected = blockedSamples.filter((item) => blockedHits(item.text).length > 0);
    const recall = detected.length / blockedSamples.length;
    const missed = blockedSamples.filter((item) => blockedHits(item.text).length === 0).map((item) => item.id);
    expect(missed, `未命中的样例：${missed.join(',')}`).toEqual([]);
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });

  it('合规样例误拦截率不高于 10%', () => {
    const falsePositives = cleanSamples.filter((item) => blockedHits(item.text).length > 0);
    const rate = falsePositives.length / cleanSamples.length;
    expect(falsePositives.map((item) => item.id), `误拦截样例：${falsePositives.map((item) => item.id).join(',')}`).toEqual([]);
    expect(rate).toBeLessThanOrEqual(0.1);
  });

  it('待复核样例不会被阻断，且绝大多数能被标记', () => {
    reviewSamples.forEach((item) => expect(blockedHits(item.text), item.id).toEqual([]));
    const flagged = reviewSamples.filter(
      (item) => reviewHits(item.text).length > 0 || blockedHits(item.text).length > 0,
    );
    expect(flagged.length / reviewSamples.length).toBeGreaterThanOrEqual(0.7);
  });
});

describe('否定与免责语境处理', () => {
  it('“我不会催促您立即操作，也无法承诺收益”不触发阻断', () => {
    const verdict = checkText('我不会催促您立即操作，也无法承诺收益。', { scope: 'message' });
    expect(verdict.passed).toBe(true);
    expect(verdict.findings.filter((finding) => finding.severity === '阻断')).toEqual([]);
  });

  it('否定语境下的命中有可见留痕', () => {
    const verdict = checkText('我不会催促您立即操作。', { scope: 'message' });
    const hit = verdict.findings.find((finding) => finding.rule === 'SUITABILITY-02');
    expect(hit?.status).toBe('通过');
    expect(hit?.detail).toContain('否定');
  });

  it('缺少不承诺收益声明会被标记为待审批', () => {
    const verdict = checkText('今天市场下跌较多，请关注您的持仓。', { scope: 'message' });
    const missing = verdict.findings.find((finding) => finding.rule === 'RISK-DISCLOSURE-02');
    expect(missing?.status).toBe('待审批');
    expect(missing?.severity).toBe('提示');
  });

  it('命中阻断时返回原文片段与位置，便于审计还原', () => {
    const verdict = checkText('请立即清仓，避免更大损失。', { scope: 'message' });
    expect(verdict.passed).toBe(false);
    const finding = verdict.findings.find((item) => item.severity === '阻断');
    expect(finding?.evidence).toBeTruthy();
    expect(finding?.index).toBeGreaterThanOrEqual(0);
  });
});

describe('适当性矩阵', () => {
  it('产品风险超出客户等级两档及以上时阻断', () => {
    expect(checkSuitability('C1', 4)).toBe('block');
    expect(checkSuitability('C2', 5)).toBe('block');
  });

  it('超出一档时要求复核', () => {
    expect(checkSuitability('C2', 3)).toBe('review');
    expect(checkSuitability('C3', 4)).toBe('review');
  });

  it('匹配或低于客户等级时放行', () => {
    expect(checkSuitability('C4', 4)).toBe('allow');
    expect(checkSuitability('C5', 3)).toBe('allow');
  });
});
