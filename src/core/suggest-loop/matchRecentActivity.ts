// CT-0021-02 — Suggest Loop v0: Recent Activity Pattern Matcher
//
// Deterministic, conservative keyword matcher. Maps explicit language
// signals in a single recent-activity string to SuggestCandidate[].
// No LLM, no persistence, no merge/dedupe, no confidence adjustment.

import { createCandidate, type SuggestCandidate, type CandidateType } from './candidate.js';
import { matchSentences, type MatchType } from '../extraction/matcher/pattern-matcher.js';

export function matchRecentActivity(input: string): SuggestCandidate[] {
  const matches = matchSentences(input);
  return matches.map(m => createCandidate(m.type as CandidateType, m.text));
}
