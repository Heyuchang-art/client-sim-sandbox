import { evaluateComplianceCorpus, type ComplianceEval } from './benchmark';

/**
 * 合规规则集评测：输出召回率、误拦截率与逐条漏检/误拦明细。
 * 语料见 evals/compliance-corpus.jsonl（禁止 / 待复核 / 合规 三类标注样本）。
 */
export function complianceReport(evaluation: ComplianceEval) {
  const lines = [
    '# 合规规则集评测',
    '',
    '- 样本总数：' + evaluation.total + '（命中阻断 ' + evaluation.blocked + ' · 命中待复核 ' + evaluation.review + ' · 未命中 ' + evaluation.clean + '）',
    '- 禁止性样例召回：' + (evaluation.blockedRecall * 100).toFixed(1) + '%（阈值 95%）',
    '- 待复核样例召回：' + (evaluation.reviewRecall * 100).toFixed(1) + '%',
    '- 综合召回：' + (evaluation.recall * 100).toFixed(1) + '%',
    '- 误拦截率：' + (evaluation.falseBlockRate * 100).toFixed(1) + '%（阈值 10%）',
    '- 结论：' + (evaluation.passed ? '通过' : '未通过'),
    '',
    '- 漏检样本：' + (evaluation.missed.join('、') || '无'),
    '- 误拦截样本：' + (evaluation.falseBlocked.join('、') || '无'),
  ];
  return lines.join('\n');
}

function main() {
  const evaluation = evaluateComplianceCorpus();
  console.log(complianceReport(evaluation));
  if (!evaluation.passed) process.exitCode = 1;
}

const invokedDirectly = process.argv[1]?.includes('eval-compliance');
if (invokedDirectly) main();
