// CT-0021-06 — Suggest Loop v0: minimal pipeline / demo entry
//
// Connects CT-0021-01..05 into a single runnable closed loop:
//   recent[] → candidates → suggestions → actions → store
// No UI, no persistence, no Observe linkage.

import { generateCandidatesFromRecent } from './generateCandidatesFromRecent.js';
import { buildSuggestions, type SuggestionItem } from './buildSuggestions.js';
import { confirmSuggestion, emptyStore, type UserModelStore } from './confirmSuggestion.js';

export type SuggestAction = 'confirm' | 'skip';

export interface SuggestLoopInput {
  recent: string[];
  actions: SuggestAction[];
}

export interface SuggestLoopResult {
  suggestions: SuggestionItem[];
  store: UserModelStore;
}

export function runSuggestLoop(input: SuggestLoopInput): SuggestLoopResult {
  const suggestions = buildSuggestions(generateCandidatesFromRecent(input.recent));

  const store = suggestions.reduce((s, suggestion, i) => {
    const action: SuggestAction = input.actions[i] ?? 'skip';
    return confirmSuggestion(s, suggestion, action);
  }, emptyStore());

  return { suggestions, store };
}
