import { describe, expect, it } from 'vitest';
import { defaultScenario } from '../scenario';
import { bm25Search, isKnowledgeMissing } from './rag';
import { compareModes } from './compare';


describe('知识缺失判定', () => {
  it('检索不到相关内容时判定为知识缺失', () => {
    expect(isKnowledgeMissing([])).toBe(true);
    expect(isKnowledgeMissing(bm25Search('完全无关的外星语词汇 xyzzy'))).toBe(true);
  });

  it('检索到相关内容时不算缺失', () => {
    const hits = bm25Search('暴跌 客户沟通 适当性 风险揭示', 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(isKnowledgeMissing(hits)).toBe(false);
  });

  it('知识缺失时对照模式显式降级并在说明中标注', () => {
    const { outcomes } = compareModes(defaultScenario, { query: '完全无关的外星语词汇 xyzzy' });
    const rag = outcomes.find((item) => item.mode === 'llm-rag')!;
    expect(rag.note).toContain('知识缺失');
    expect(rag.retrieved).toEqual([]);
  });
});
