// CT-0021-03 — Suggest Loop v0: Candidate Generator
//
// Iterates a recent-activity list, runs matchRecentActivity() on each entry,
// and returns a flattened SuggestCandidate[] in input order.
// No dedupe, no merge, no ranking, no persistence.

import { type SuggestCandidate } from './candidate.js';
import { matchRecentActivity } from './matchRecentActivity.js';

export function generateCandidatesFromRecent(inputs: string[]): SuggestCandidate[] {
  return inputs.flatMap(input => matchRecentActivity(input));
}
