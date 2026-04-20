// CT-0021-04 — Suggest Loop v0: Candidate → SuggestionItem compiler
//
// Compiles SuggestCandidate[] into display-ready SuggestionItem[].
// One-to-one mapping, stable order, deterministic ids.
// No confirm/skip logic, no user model writes, no dedup.

import { type SuggestCandidate } from './candidate.js';

export interface SuggestionItem {
  id: string;
  type: 'preference' | 'goal' | 'constraint';
  content: string;
  displayText: string;
}

const DISPLAY_PREFIX: Record<SuggestionItem['type'], string> = {
  preference: 'Add this as a preference',
  goal: 'Add this as a goal',
  constraint: 'Add this as a constraint',
};

export function buildSuggestions(candidates: SuggestCandidate[]): SuggestionItem[] {
  return candidates.map((c, index) => ({
    id: `${index}:${c.type}:${c.content}`,
    type: c.type,
    content: c.content,
    displayText: `${DISPLAY_PREFIX[c.type]}: ${c.content}`,
  }));
}
