// CT-0021-05 — Suggest Loop v0: confirm / skip → append-only write
//
// Pure function. confirm appends one entry to the store; skip is a no-op.
// No dedupe, no merge, no persistence, no Observe linkage.

import { type SuggestionItem } from './buildSuggestions.js';

export interface UserModelEntry {
  type: 'preference' | 'goal' | 'constraint';
  content: string;
  source: 'suggest_loop';
}

export interface UserModelStore {
  entries: UserModelEntry[];
}

export function emptyStore(): UserModelStore {
  return { entries: [] };
}

export function confirmSuggestion(
  store: UserModelStore,
  suggestion: SuggestionItem,
  action: 'confirm' | 'skip',
): UserModelStore {
  if (action === 'skip') return store;
  return {
    entries: [
      ...store.entries,
      { type: suggestion.type, content: suggestion.content, source: 'suggest_loop' },
    ],
  };
}
