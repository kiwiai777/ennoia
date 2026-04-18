// Basic Extractor
// 不调用 LLM。按换行和中英文标点切句，去空白后作为候选。
// 输入是 SourceBlock[]，每块的候选继承该块的 source_path（不合并不改写）。
// 去重键为 (归一文本 + source_path)，允许同一句话出现在不同文件。

import type { SourceBlock } from '../../adapters/base.js';
import type { CandidateItem } from './types.js';

const MAX_CANDIDATE_LEN = 80;
const MIN_CANDIDATE_LEN = 2;

const SPLIT_RE = /[\n。！？.!?;；]+/;

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function basicExtract(blocks: SourceBlock[]): CandidateItem[] {
  const seen = new Set<string>();
  const out: CandidateItem[] = [];

  for (const block of blocks) {
    for (const raw of block.text.split(SPLIT_RE)) {
      const text = normalize(raw);
      if (text.length < MIN_CANDIDATE_LEN) continue;

      const clipped =
        text.length > MAX_CANDIDATE_LEN
          ? text.slice(0, MAX_CANDIDATE_LEN) + '…'
          : text;

      const key = `${clipped}::${block.source_path}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ text: clipped, source_path: block.source_path });
    }
  }

  return out;
}
