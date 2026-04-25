import type { ExtractionInput, ExtractionCandidate } from './types.js';
import { extractFromPackageManifest } from './package-manifest.js';
import { extractFromMarkdown } from './markdown.js';
import { extractFromPlain } from './plain.js';

export function extract(input: ExtractionInput): ExtractionCandidate[] {
  const candidates: ExtractionCandidate[] = [];

  for (const block of input.contentBlocks) {
    let blockCandidates: ExtractionCandidate[] = [];

    switch (block.hint) {
      case 'package-manifest':
        blockCandidates = extractFromPackageManifest(block, input.sourceId);
        break;
      case 'agent-def':
      case 'skill-def':
      case 'readme':
      case 'user-profile':
        blockCandidates = extractFromMarkdown(block, input.sourceId);
        break;
      case 'plain':
      default:
        // By default use plain extraction
        blockCandidates = extractFromPlain(block, input.sourceId);
        break;
    }

    candidates.push(...blockCandidates);
  }

  return candidates;
}