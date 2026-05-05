// Base pattern matcher separated from suggest-loop
// Can be shared by both suggest-loop and extraction layers

export type MatchType = 'preference' | 'goal' | 'constraint';

export interface MatchResult {
  type: MatchType;
  text: string;
}

const PATTERNS: Array<{ type: MatchType; triggers: string[] }> = [
  {
    type: 'preference',
    triggers: [
      '我更喜欢', '我喜欢', '我偏好', '我偏爱', '我倾向于', '我爱用', '我习惯用',
      'i prefer', 'my preference is', "i'd rather", 'i tend to', 'i favor',
      'i always use', 'i typically use', 'my approach is', 'i stick to', 'i go with',
    ],
  },
  {
    type: 'goal',
    triggers: [
      '我的目标是', '我正在推进', '我计划', '我打算', '我要把', '我想要',
      'my goal is', "i'm working on", 'i plan to', 'i aim to', "i'm trying to",
      'i need to', 'i want to', "i'm focused on", 'my objective is', 'i intend to',
    ],
  },
  {
    type: 'constraint',
    triggers: [
      '我不想', '时间很紧', '时间紧迫', '成本敏感', '不允许',
      "i don't want", "i can't", 'time is tight', 'deadline is', 'budget is limited',
      'i must avoid', 'i need to avoid', 'not allowed to', 'restricted from', 'limited by',
    ],
  },
];

// Sentences containing these words are skipped to avoid false positives.
const HEDGE_WORDS = [
  '也许', '可能', '是不是', '假设', '有人说', '比如说', '如果', '或许',
  'maybe', 'perhaps', 'if', 'assuming', 'what if', 'suppose', 'hypothetically',
  'someone said', 'for example', 'possibly',
];

// Chinese/ASCII quote chars — presence indicates quoted speech.
const QUOTE_CHARS = ['\u201c', '\u201d', '\u2018', '\u2019'];

// Reporting verb + colon patterns indicating third-party attribution.
const REPORT_PREFIXES = ['说：', '提到：', '表示：', '认为：', '告诉我：', '说道：'];

// English question starters (case-insensitive)
const ENGLISH_QUESTION_STARTERS = [
  'do', 'does', 'did', 'can', 'could', 'would', 'should', 'is', 'are', 'will',
  'was', 'were', 'have', 'has', 'had', 'may', 'might', 'shall',
];

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

function isEnglishQuestion(text: string): boolean {
  // Only check for English questions if the text contains ASCII letters
  if (!/[a-zA-Z]/.test(text)) return false;
  const firstWord = text.split(/\s+/)[0]?.toLowerCase();
  return ENGLISH_QUESTION_STARTERS.includes(firstWord ?? '');
}

function shouldSkip({ text, isQuestion }: Sentence): boolean {
  if (isQuestion) return true;
  const lowerText = text.toLowerCase();
  // Check hedge words with case-insensitive comparison for English
  if (HEDGE_WORDS.some(w => {
    const lowerWord = w.toLowerCase();
    return text.includes(w) || lowerText.includes(lowerWord);
  })) return true;
  if (QUOTE_CHARS.some(q => text.includes(q))) return true;
  if (REPORT_PREFIXES.some(p => text.includes(p))) return true;
  return false;
}

function matchSentence(sentence: Sentence): MatchResult | null {
  if (shouldSkip(sentence)) return null;
  const lowerText = sentence.text.toLowerCase();
  for (const { type, triggers } of PATTERNS) {
    // Check both original text (for Chinese) and lowercase (for English)
    if (triggers.some(t => sentence.text.includes(t) || lowerText.includes(t.toLowerCase()))) {
      return { type, text: sentence.text };
    }
  }
  return null;
}

export function matchSentences(input: string): MatchResult[] {
  return splitSentences(input)
    .map(s => matchSentence(s))
    .filter((c): c is MatchResult => c !== null);
}