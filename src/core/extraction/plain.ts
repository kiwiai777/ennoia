import type { ContentBlock, ExtractionCandidate } from './types.js';
import { matchSentences } from './matcher/pattern-matcher.js';

export function extractFromPlain(
  block: ContentBlock,
  sourceId: string
): ExtractionCandidate[] {
  const candidates: ExtractionCandidate[] = [];
  const provenance = { source: sourceId, path: block.path };

  if (!block.content) return candidates;

  const matches = matchSentences(block.content);

  for (const match of matches) {
    // Only map known types to prevent mismatch
    if (match.type === 'goal' || match.type === 'preference' || match.type === 'constraint') {
      candidates.push({
        kind: match.type,
        content: match.text,
        provenance
      });
    }
  }

  return candidates;
}