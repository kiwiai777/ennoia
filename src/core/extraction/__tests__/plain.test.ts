import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromPlain } from '../plain.js';
import type { ContentBlock } from '../types.js';

describe('extractFromPlain', () => {
  it('extracts preference, goal, constraint from pattern matching', () => {
    const block: ContentBlock = {
      path: 'CLAUDE.md',
      content: '我更喜欢 TypeScript。我的目标是重构架构。时间很紧。',
      kind: 'plain',
      hint: 'plain'
    };
    const candidates = extractFromPlain(block, 'test-src');
    
    assert.ok(candidates.some(c => c.kind === 'preference' && c.content === '我更喜欢 TypeScript'));
    assert.ok(candidates.some(c => c.kind === 'goal' && c.content === '我的目标是重构架构'));
    assert.ok(candidates.some(c => c.kind === 'constraint' && c.content === '时间很紧'));
  });

  it('skips hedged sentences', () => {
    const block: ContentBlock = {
      path: 'CLAUDE.md',
      content: '也许我喜欢 TypeScript。如果我的目标是重构。',
      kind: 'plain',
      hint: 'plain'
    };
    const candidates = extractFromPlain(block, 'test-src');
    
    assert.equal(candidates.length, 0);
  });
});
