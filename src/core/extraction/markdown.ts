import type { ContentBlock, ExtractionCandidate, ExtractionInput } from './types.js';
import { matchSentences } from './matcher/pattern-matcher.js';

function extractCodeBlockLanguages(content: string): string[] {
  const languages = new Set<string>();
  const regex = /```([a-zA-Z0-9_-]+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) {
      languages.add(match[1]);
    }
  }
  return Array.from(languages);
}

export function extractUserProfile(block: ContentBlock, provenance: { source: string; path: string }): ExtractionCandidate[] {
  const candidates: ExtractionCandidate[] = [];

  const matches = matchSentences(block.content);
  for (const match of matches) {
    if (match.type === 'goal' || match.type === 'preference' || match.type === 'constraint') {
      candidates.push({
        kind: match.type,
        content: match.text,
        provenance
      });
    }
  }

  // A basic fallback if sentences don't match the standard patterns
  // We can treat bullet points in preferences/goals as facts
  // We just collect all bullet items that aren't obvious metadata
  if (candidates.length === 0) {
    const lines = block.content.split('\n');
    let inSection = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('##')) {
        inSection = true;
      }
      if (inSection && trimmed.startsWith('- ') && !trimmed.includes('**')) {
        candidates.push({
          kind: 'preference',
          content: trimmed.replace(/^- /, '').trim(),
          provenance
        });
      } else if (inSection && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-') && !trimmed.startsWith('_') && !trimmed.startsWith('<') && !trimmed.startsWith('**') && !trimmed.startsWith('<!--') && !trimmed.includes('---') && !trimmed.includes('===')) {
         candidates.push({
            kind: 'preference',
            content: trimmed,
            provenance
         });
      }
    }
  }

  return candidates;
}

export function extractFromMarkdown(
  block: ContentBlock,
  sourceId: string
): ExtractionCandidate[] {
  const candidates: ExtractionCandidate[] = [];
  const provenance = { source: sourceId, path: block.path };

  if (!block.content) return candidates;

  if (block.hint === 'user-profile') {
    return extractUserProfile(block, provenance);
  }

  const lines = block.content.split('\n');

  // Agent definition extraction
  if (block.hint === 'agent-def') {
    // Very simple heuristic: looking for role or instructions
    let inRole = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '# Role') {
        inRole = true;
        continue;
      }
      if (inRole && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
        candidates.push({
          kind: 'preference',
          content: trimmed,
          provenance
        });
      } else if (trimmed.startsWith('- Never') || trimmed.startsWith('- Always')) {
        candidates.push({
          kind: 'constraint',
          content: trimmed.replace(/^- /, '').trim(),
          provenance
        });
      }
    }
  }

  // Skill definition extraction
  if (block.hint === 'skill-def') {
    // Assuming the first heading is the skill name
    const titleMatch = block.content.match(/^#\s+(.+)$/m);
    if (titleMatch && titleMatch[1]) {
      candidates.push({
        kind: 'skill',
        content: titleMatch[1].trim(),
        provenance
      });
    }
  }

  // Readme extraction
  if (block.hint === 'readme') {
    // First heading is likely project name
    const titleMatch = block.content.match(/^#\s+(.+)$/m);
    if (titleMatch && titleMatch[1]) {
      candidates.push({
        kind: 'project',
        content: titleMatch[1].trim(),
        provenance
      });
    }
  }

  // General extraction for all markdown
  // 1. Code block languages to skills
  const langs = extractCodeBlockLanguages(block.content);
  for (const lang of langs) {
    // Avoid short garbage like "ts" mapping to "ts", map to something reasonable if needed
    // or just let it be. We'll map ts to TypeScript, js to JavaScript
    let skillName = lang;
    if (lang.toLowerCase() === 'ts' || lang.toLowerCase() === 'typescript') skillName = 'TypeScript';
    if (lang.toLowerCase() === 'js' || lang.toLowerCase() === 'javascript') skillName = 'JavaScript';
    if (lang.toLowerCase() === 'sh' || lang.toLowerCase() === 'bash') skillName = 'Bash';

    candidates.push({
      kind: 'skill',
      content: skillName,
      provenance
    });
  }

  // 2. Headings might indicate skills (e.g. ## React Setup)
  for (const line of lines) {
    if (line.startsWith('#')) {
      const heading = line.replace(/^#+\s*/, '').trim();
      if (heading.toLowerCase().includes('react')) {
         candidates.push({ kind: 'skill', content: 'React', provenance });
      }
      if (heading.toLowerCase().includes('typescript')) {
         candidates.push({ kind: 'skill', content: 'TypeScript', provenance });
      }
    }
  }

  // Deduplicate simple exact matches
  const uniqueCandidates: ExtractionCandidate[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    const key = `${c.kind}:${c.content}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCandidates.push(c);
    }
  }

  return uniqueCandidates;
}
