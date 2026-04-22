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

  it('3a: package.json extra fields are stripped before ContentBlock', () => {
    const pkgContent = JSON.stringify({
      name: 'my-pkg',
      description: 'test pkg',
      private: true,
      config: { apiKey: 'secret123' },
      publishConfig: { registry: 'https://private.registry.example' },
      dependencies: { react: '^18.0.0' },
    });
    fs.writeFileSync(path.join(tmpDir, 'package.json'), pkgContent);

    const blocks = scanWorkspace(tmpDir);
    const pkg = blocks.find(b => b.path === 'package.json');
    assert.ok(pkg, 'package.json block must exist');

    // Whitelist fields must be present
    assert.ok(pkg.content.includes('"name"'), 'name must be present');
    assert.ok(pkg.content.includes('"description"'), 'description must be present');
    assert.ok(pkg.content.includes('"dependencies"'), 'dependencies must be present');

    // Non-whitelist fields must not appear
    assert.ok(!pkg.content.includes('private'), 'private must be stripped');
    assert.ok(!pkg.content.includes('apiKey'), 'config.apiKey must be stripped');
    assert.ok(!pkg.content.includes('publishConfig'), 'publishConfig must be stripped');
    assert.ok(!pkg.content.includes('secret123'), 'secret value must not appear');
  });

  it('3b: total budget exceeded stops scanning (not just skips current file)', () => {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });

    // Each agent file is ~50KB; 12 of them = ~600KB, exceeds 500KB budget
    const chunk = Buffer.alloc(50 * 1024, 'x').toString();
    for (let i = 0; i < 12; i++) {
      fs.writeFileSync(path.join(agentsDir, `agent-${String(i).padStart(2, '0')}.md`), chunk);
    }

    const blocks = scanWorkspace(tmpDir);

    // Total bytes in blocks must not exceed budget
    const totalBytes = blocks.reduce((s, b) => s + b.content.length, 0);
    assert.ok(totalBytes <= 500 * 1024, `total bytes ${totalBytes} must be <= 500KB`);

    // Not all 12 agent files were scanned — some must be absent
    const agentBlocks = blocks.filter(b => b.path.startsWith('.claude/agents/'));
    assert.ok(agentBlocks.length < 12, `only ${agentBlocks.length} of 12 agent files scanned — budget stopped scan`);
  });

  it('3c: deny-listed files are not read when allowed files coexist', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# README');

    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'agent.md'), '# Agent');

    // Deny-listed files
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'code');
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=abc');
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');

    const blocks = scanWorkspace(tmpDir);
    const paths = blocks.map(b => b.path);

    assert.ok(paths.includes('README.md'), 'README.md must be scanned');
    assert.ok(paths.some(p => p.includes('agent.md')), 'agent.md must be scanned');

    assert.ok(!paths.some(p => p.includes('index.ts')), 'src/index.ts must not be scanned');
    assert.ok(!paths.includes('.env'), '.env must not be scanned');
    assert.ok(!paths.includes('package-lock.json'), 'package-lock.json must not be scanned');
  });
});
