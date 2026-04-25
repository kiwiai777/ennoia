// CT-0021-06 — Suggest Loop v0: minimal pipeline / demo entry
//
// Connects CT-0021-01..05 into a single runnable closed loop:
//   recent[] → candidates → suggestions
// (Store component was removed in CT-0025-01 as reflect now writes to main user_model.json)

import { generateCandidatesFromRecent } from './generateCandidatesFromRecent.js';
import { buildSuggestions, type SuggestionItem } from './buildSuggestions.js';

export interface SuggestLoopInput {
  recent: string[];
}

export interface SuggestLoopResult {
  suggestions: SuggestionItem[];
}

export function runSuggestLoop(input: SuggestLoopInput): SuggestLoopResult {
  const suggestions = buildSuggestions(generateCandidatesFromRecent(input.recent));
  return { suggestions };
}
