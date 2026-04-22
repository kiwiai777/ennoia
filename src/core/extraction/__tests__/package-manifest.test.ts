import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromPackageManifest } from '../package-manifest.js';
import type { ContentBlock } from '../types.js';

describe('extractFromPackageManifest', () => {
  it('extracts project name and description', () => {
    const block: ContentBlock = {
      path: 'package.json',
      content: JSON.stringify({ name: 'my-proj', description: 'desc' }),
      kind: 'json',
      hint: 'package-manifest'
    };
    const candidates = extractFromPackageManifest(block, 'test-src');
    
    assert.ok(candidates.some(c => c.kind === 'project' && c.content.includes('my-proj')));
    assert.ok(candidates.some(c => c.kind === 'project' && c.content.includes('desc')));
    // Provenance
    assert.equal(candidates[0].provenance.source, 'test-src');
    assert.equal(candidates[0].provenance.path, 'package.json');
  });

  it('extracts skills from known dependencies', () => {
    const block: ContentBlock = {
      path: 'package.json',
      content: JSON.stringify({
        dependencies: {
          'react': '^18',
          'unknown-lib': '1.0'
        },
        devDependencies: {
          'typescript': '^5'
        }
      }),
      kind: 'json',
      hint: 'package-manifest'
    };
    const candidates = extractFromPackageManifest(block, 'test-src');
    
    const skills = candidates.filter(c => c.kind === 'skill').map(c => c.content);
    assert.ok(skills.includes('React'));
    assert.ok(skills.includes('TypeScript'));
    assert.ok(!skills.includes('unknown-lib'));
  });

  it('extracts constraint from node engines', () => {
    const block: ContentBlock = {
      path: 'package.json',
      content: JSON.stringify({
        engines: { node: '>=18' }
      }),
      kind: 'json',
      hint: 'package-manifest'
    };
    const candidates = extractFromPackageManifest(block, 'test-src');
    
    assert.ok(candidates.some(c => c.kind === 'constraint' && c.content.includes('>=18')));
  });

  it('fail-soft on invalid JSON', () => {
    const block: ContentBlock = {
      path: 'package.json',
      content: '{ invalid json',
      kind: 'json',
      hint: 'package-manifest'
    };
    const candidates = extractFromPackageManifest(block, 'test-src');
    assert.equal(candidates.length, 0);
  });
});
