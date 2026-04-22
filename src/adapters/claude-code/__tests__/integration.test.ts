import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractFromClaudeCodeWorkspace } from '../index.js';

describe('extractFromClaudeCodeWorkspace', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-claude-integration-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts correctly from a full mock workspace', async () => {
    // Setup full workspace
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'integration-test',
      dependencies: { react: '^18' }
    }));
    
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Integ Project\nHello.');
    
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '我喜欢用 React 写前端。');
    
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir);
    
    fs.mkdirSync(path.join(claudeDir, 'agents'));
    fs.writeFileSync(path.join(claudeDir, 'agents', 'my-agent.md'), '# Role\nCool Agent\n- Never use var');
    
    fs.mkdirSync(path.join(claudeDir, 'skills'));
    fs.writeFileSync(path.join(claudeDir, 'skills', 'my-skill.md'), '# Custom Skill');

    const candidates = await extractFromClaudeCodeWorkspace(tmpDir);

    // Verify package.json extraction
    assert.ok(candidates.some(c => c.kind === 'project' && c.content.includes('integration-test')));
    assert.ok(candidates.some(c => c.kind === 'skill' && c.content === 'React'));
    
    // Verify README extraction
    assert.ok(candidates.some(c => c.kind === 'project' && c.content === 'Integ Project'));
    
    // Verify CLAUDE.md extraction
    assert.ok(candidates.some(c => c.kind === 'preference' && c.content === '我喜欢用 React 写前端'));
    
    // Verify agent-def extraction
    assert.ok(candidates.some(c => c.kind === 'preference' && c.content === 'Cool Agent'));
    assert.ok(candidates.some(c => c.kind === 'constraint' && c.content === 'Never use var'));
    
    // Verify skill-def extraction
    assert.ok(candidates.some(c => c.kind === 'skill' && c.content === 'Custom Skill'));

    // Check provenance
    for (const c of candidates) {
      assert.equal(c.provenance.source, 'claude-code');
      assert.ok(typeof c.provenance.path === 'string');
    }
  });

  it('handles empty workspace gracefully', async () => {
    const candidates = await extractFromClaudeCodeWorkspace(tmpDir);
    assert.equal(candidates.length, 0);
  });
});
