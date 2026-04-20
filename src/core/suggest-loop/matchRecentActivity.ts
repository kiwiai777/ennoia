// CT-0021-02 — Suggest Loop v0: Recent Activity Pattern Matcher
//
// Deterministic, conservative keyword matcher. Maps explicit language
// signals in a single recent-activity string to SuggestCandidate[].
// No LLM, no persistence, no merge/dedupe, no confidence adjustment.

import { createCandidate, type SuggestCandidate, type CandidateType } from './candidate.js';

const PATTERNS: Array<{ type: CandidateType; triggers: string[] }> = [
  {
    type: 'preference',
    triggers: ['我更喜欢', '我喜欢', '我偏好', '我偏爱', '我倾向于', '我爱用', '我习惯用'],
  },
  {
    type: 'goal',
    triggers: ['我的目标是', '我正在推进', '我计划', '我打算', '我要把', '我想要'],
  },
  {
    type: 'constraint',
    triggers: ['我不想', '时间很紧', '时间紧迫', '成本敏感', '不允许'],
  },
];

// Sentences containing these words are skipped to avoid false positives.
const HEDGE_WORDS = ['也许', '可能', '是不是', '假设', '有人说', '比如说', '如果', '或许'];

interface Sentence {
  text: string;
  isQuestion: boolean;
}

function splitSentences(input: string): Sentence[] {
  const result: Sentence[] = [];
  // Split on sentence-ending punctuation, capturing the delimiter to detect questions.
  const parts = input.split(/([。！？；\n])/);
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i].trim();
    const delimiter = parts[i + 1] ?? '';
    if (text.length > 0) {
      result.push({ text, isQuestion: delimiter === '？' || delimiter === '?' });
    }
  }
  return result;
}

function shouldSkip({ text, isQuestion }: Sentence): boolean {
  if (isQuestion) return true;
  return HEDGE_WORDS.some(w => text.includes(w));
}

function matchSentence(sentence: Sentence): SuggestCandidate | null {
  if (shouldSkip(sentence)) return null;
  for (const { type, triggers } of PATTERNS) {
    if (triggers.some(t => sentence.text.includes(t))) {
      return createCandidate(type, sentence.text);
    }
  }
  return null;
}

export function matchRecentActivity(input: string): SuggestCandidate[] {
  return splitSentences(input)
    .map(s => matchSentence(s))
    .filter((c): c is SuggestCandidate => c !== null);
}
