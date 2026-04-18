// Suggestion 层共享类型
//
// SuggestionItem 是 suggester（basic / llm）输出的"候选建议"——尚未进
// user model，需要用户在 CLI 里选择后才会写入。
//
// source 固定为以下两种之一，用于区分条目来自哪一种 suggester；
// 写入 user model 时直接沿用，不再加工。

export type SuggestionType = 'goal' | 'constraint' | 'preference';

export type SuggestionSource = 'cli:suggest:basic' | 'cli:suggest:llm';

export interface SuggestionItem {
  type: SuggestionType;
  text: string;
  source: SuggestionSource;
}
