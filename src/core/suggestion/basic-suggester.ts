// Basic Suggester
//
// 不调用 LLM。把输入文本按换行和中英文标点切成小句，对每一句根据关键词
// 启发式判断属于 goal / constraint / preference 中的哪一类；无法判断的小句
// 直接丢弃。
//
// 设计取舍：
//   - 规则保持可读、可扩展，不做复杂 NLP
//   - 分类优先级 constraint > preference > goal：同一小句同时出现"想要
//     做 X"和"但要避免 Y"时以后半段的 constraint 语义为准更安全
//   - 每一小句最多产出一条建议；跨小句按 (type + 归一文本) 去重

import type { SuggestionItem, SuggestionType } from './types.js';

const CONSTRAINT_KEYWORDS = [
  '避免',
  '不要',
  '不能',
  '不应',
  '禁止',
  '受限',
  '依赖',
];

const PREFERENCE_KEYWORDS = [
  '喜欢',
  '偏好',
  '倾向',
  '更愿意',
  '宁愿',
  '更喜欢',
  '简单',
  '直接',
];

const GOAL_KEYWORDS = [
  '想',
  '目标',
  '最重要',
  '推进',
  '完成',
  '希望',
  '要做',
  '打算',
];

const SPLIT_RE = /[\n。！？.!?;；,，]+/;
const MAX_LEN = 80;
const MIN_LEN = 2;

function classify(clause: string): SuggestionType | null {
  for (const k of CONSTRAINT_KEYWORDS) if (clause.includes(k)) return 'constraint';
  for (const k of PREFERENCE_KEYWORDS) if (clause.includes(k)) return 'preference';
  for (const k of GOAL_KEYWORDS) if (clause.includes(k)) return 'goal';
  return null;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function basicSuggest(text: string): SuggestionItem[] {
  const seen = new Set<string>();
  const out: SuggestionItem[] = [];

  for (const raw of text.split(SPLIT_RE)) {
    const clause = normalize(raw);
    if (clause.length < MIN_LEN) continue;

    const type = classify(clause);
    if (!type) continue;

    const clipped =
      clause.length > MAX_LEN ? clause.slice(0, MAX_LEN) + '…' : clause;

    const key = `${type}::${clipped.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ type, text: clipped, source: 'cli:suggest:basic' });
  }

  return out;
}
