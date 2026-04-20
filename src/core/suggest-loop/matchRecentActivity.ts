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

// Chinese/ASCII quote chars — presence indicates quoted speech.
const QUOTE_CHARS = ['\u201c', '\u201d', '\u2018', '\u2019'];

// Reporting verb + colon patterns indicating third-party attribution.
const REPORT_PREFIXES = ['说：', '提到：', '表示：', '认为：', '告诉我：', '说道：'];

interface Sentence {
  text: string;
  isQuestion: boolean;
}

function splitSentences(input: string): Sentence[] {
  const result: Sentence[] = [];
  // Capture delimiter (including ASCII ?) to detect question sentences.
  const parts = input.split(/([。！？；\n?])/);
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
  if (HEDGE_WORDS.some(w => text.includes(w))) return true;
  if (QUOTE_CHARS.some(q => text.includes(q))) return true;
  if (REPORT_PREFIXES.some(p => text.includes(p))) return true;
  return false;
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
