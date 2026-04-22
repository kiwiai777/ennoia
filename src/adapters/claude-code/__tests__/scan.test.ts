import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanWorkspace } from '../scan.js';

describe('scanWorkspace', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-scan-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should fail-soft on empty or non-existent dir', () => {
    const nonExistent = path.join(tmpDir, 'non-existent');
    assert.deepEqual(scanWorkspace(nonExistent), []);
    assert.deepEqual(scanWorkspace(tmpDir), []);
  });

  it('should extract target files with correct hints', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# README');
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# CLAUDE');
    
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir);
    
    fs.mkdirSync(path.join(claudeDir, 'agents'));
    fs.writeFileSync(path.join(claudeDir, 'agents', 'my-agent.md'), '# Agent');
    
    fs.mkdirSync(path.join(claudeDir, 'skills'));
    fs.writeFileSync(path.join(claudeDir, 'skills', 'my-skill.md'), '# Skill');

    const blocks = scanWorkspace(tmpDir);
    
    assert.equal(blocks.length, 5);
    
    const packageBlock = blocks.find(b => b.path === 'package.json');
    assert.ok(packageBlock);
    assert.equal(packageBlock.hint, 'package-manifest');
    assert.equal(packageBlock.kind, 'json');

    const readmeBlock = blocks.find(b => b.path === 'README.md');
    assert.ok(readmeBlock);
    assert.equal(readmeBlock.hint, 'readme');

    const claudeBlock = blocks.find(b => b.path === 'CLAUDE.md');
    assert.ok(claudeBlock);
    assert.equal(claudeBlock.hint, 'plain');

    const agentBlock = blocks.find(b => b.path.includes('agents'));
    assert.ok(agentBlock);
    assert.equal(agentBlock.hint, 'agent-def');

    const skillBlock = blocks.find(b => b.path.includes('skills'));
    assert.ok(skillBlock);
    assert.equal(skillBlock.hint, 'skill-def');
  });

  it('should ignore non-target files (negative testing)', () => {
    // 明确不抓取的东西：commit history, transcript, source code, lock files, .env
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'console.log()');
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=123');
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(path.join(tmpDir, '.git', 'config'), 'repo config');
    
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir);
    fs.writeFileSync(path.join(claudeDir, 'history.json'), '[]');
    fs.writeFileSync(path.join(claudeDir, 'conversations.txt'), 'log');

    const blocks = scanWorkspace(tmpDir);
    assert.equal(blocks.length, 0); // Should be empty because none of the allowed files exist
  });

  it('should respect file limits in subdirectories', () => {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    
    for (let i = 0; i < 25; i++) {
      fs.writeFileSync(path.join(agentsDir, `agent-${i}.md`), `# Agent ${i}`);
    }

    const blocks = scanWorkspace(tmpDir);
    assert.equal(blocks.length, 20); // 截断到 20
  });

  it('should respect individual file size limit', () => {
    // MAX_FILE_SIZE is 100KB, create a 110KB file
    const largeContent = Buffer.alloc(110 * 1024, 'a').toString();
    fs.writeFileSync(path.join(tmpDir, 'README.md'), largeContent);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"ok"}'); // small file

    const blocks = scanWorkspace(tmpDir);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].path, 'package.json');
  });

  it('should skip non-utf8 files', () => {
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), binaryContent);

    const blocks = scanWorkspace(tmpDir);
    assert.equal(blocks.length, 0);
  });
});
