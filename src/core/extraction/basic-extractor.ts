// Basic Extractor
// 不调用 LLM。按换行和中英文标点切句，去空白后作为候选。
// 单条长度做个粗限，超长直接截断（过长通常是 JSON dump 之类，不适合当 user model 条目）。

import type { CandidateItem } from './types.js';

const MAX_CANDIDATE_LEN = 80;
const MIN_CANDIDATE_LEN = 2;

// 切分器：按换行与中英文常见句末标点分句
const SPLIT_RE = /[\n。！？.!?;；]+/;

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function basicExtract(blocks: string[]): CandidateItem[] {
  const seen = new Set<string>();
  const out: CandidateItem[] = [];

  for (const block of blocks) {
    for (const raw of block.split(SPLIT_RE)) {
      const text = normalize(raw);
      if (text.length < MIN_CANDIDATE_LEN) continue;

      const clipped =
        text.length > MAX_CANDIDATE_LEN
          ? text.slice(0, MAX_CANDIDATE_LEN) + '…'
          : text;

      if (seen.has(clipped)) continue;
      seen.add(clipped);

      out.push({ text: clipped });
    }
  }

  return out;
}
