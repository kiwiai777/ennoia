import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromMarkdown } from '../markdown.js';
import type { ContentBlock } from '../types.js';

describe('extractFromMarkdown', () => {
  it('extracts role and constraints from agent-def', () => {
    const block: ContentBlock = {
      path: '.claude/agents/my-agent.md',
      content: '# Role\nFrontend Expert\n- Never use var\n- Always use TS',
      kind: 'markdown',
      hint: 'agent-def'
    };
    const candidates = extractFromMarkdown(block, 'test-src');
    
    assert.ok(candidates.some(c => c.kind === 'preference' && c.content === 'Frontend Expert'));
    assert.ok(candidates.some(c => c.kind === 'constraint' && c.content === 'Never use var'));
    assert.ok(candidates.some(c => c.kind === 'constraint' && c.content === 'Always use TS'));
  });

  it('extracts skill from skill-def title', () => {
    const block: ContentBlock = {
      path: '.claude/skills/my-skill.md',
      content: '# GraphQL Setup\nSome text.',
      kind: 'markdown',
      hint: 'skill-def'
    };
    const candidates = extractFromMarkdown(block, 'test-src');
    
    assert.ok(candidates.some(c => c.kind === 'skill' && c.content === 'GraphQL Setup'));
  });

  it('extracts project from readme title', () => {
    const block: ContentBlock = {
      path: 'README.md',
      content: '# Cortex Agent\nSome description.',
      kind: 'markdown',
      hint: 'readme'
    };
    const candidates = extractFromMarkdown(block, 'test-src');
    
    assert.ok(candidates.some(c => c.kind === 'project' && c.content === 'Cortex Agent'));
  });

  it('extracts code block languages as skills', () => {
    const block: ContentBlock = {
      path: 'docs.md',
      content: '```typescript\nconst a = 1;\n```\n```rust\nlet a = 1;\n```',
      kind: 'markdown',
      hint: 'plain'
    };
    const candidates = extractFromMarkdown(block, 'test-src');
    
    assert.ok(candidates.some(c => c.kind === 'skill' && c.content === 'TypeScript'));
    assert.ok(candidates.some(c => c.kind === 'skill' && c.content === 'rust'));
  });
});
