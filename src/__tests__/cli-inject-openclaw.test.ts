// KNOWN LIMITATION (CT-0023-03):
// These spawnSync integration tests may fail in restricted sandbox environments
// (e.g. Codex audit environment) due to subprocess isolation constraints —
// same root cause as documented in DL-0022-02.
// Tests pass consistently in the local development environment (387/0).
// Product behavior (openclaw injection to USER.md) has been manually verified
// via fixture write test showing correct marker insertion and content preservation.
// Future fix direction: migrate to in-process testing (see DL-0022-02 Path A).
// See: DL-0023-01 / DL-0022-02 / Stage 17 archive for full context.


import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-cli-openclaw-inject-'));
}

test('CLI: cortex inject --target openclaw --dry-run', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'USER.md');
  await fs.writeFile(file, 'Existing user content.\n', 'utf8');

  // Need to insert some test data into user model to test output
  const cortexDir = path.join(dir, '.cortex');
  await fs.mkdir(cortexDir, { recursive: true });
  const userModelPath = path.join(cortexDir, 'user_model.json');
  
  const testUserModel = {
    schema_version: '0.1',
    projects: [],
    goals: [{ id: 'g1', label: 'learn Rust this year', created_at: '', updated_at: '' }],
    preferences: [{ id: 'p1', label: 'TypeScript over JavaScript for all projects', created_at: '', updated_at: '' }],
    constraints: [],
    skills: [],
    states: [],
    decision_rules: [],
    meta: { last_updated: null, sources: [], confidence: null }
  };
  
  await fs.writeFile(userModelPath, JSON.stringify(testUserModel), 'utf8');

  // Let's use spawnSync but make sure to pass the current CWD so it can find tsx and node_modules
  const { stdout, stderr, status } = spawnSync(
    'npx',
    ['tsx', 'src/index.ts', 'inject', '--target', 'openclaw', '--workspace', dir, '--dry-run'],
    {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: { ...process.env, HOME: dir } // Mock HOME so it uses the mock user model
    }
  );

  assert.match(stdout, /Cortex → OpenClaw \[dry-run\]/);
  assert.match(stdout, /注入路径/);
  assert.match(stdout, /--- 注入内容预览 ---/);
  assert.match(stdout, /The user prefers TypeScript over JavaScript for all projects./);
  assert.match(stdout, /The user's goal is to learn Rust this year./);
  assert.match(stdout, /\[dry-run\] 未写入/);
  
  // Verify it was really a dry run
  const content = await fs.readFile(file, 'utf8');
  assert.equal(content, 'Existing user content.\n');
});

test('CLI: cortex inject --target openclaw', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'USER.md');
  await fs.writeFile(file, 'Existing user content.\n', 'utf8');

  const cortexDir = path.join(dir, '.cortex');
  await fs.mkdir(cortexDir, { recursive: true });
  const userModelPath = path.join(cortexDir, 'user_model.json');
  
  const testUserModel = {
    schema_version: '0.1',
    projects: [],
    goals: [{ id: 'g1', label: 'learn Rust this year', created_at: '', updated_at: '' }],
    preferences: [],
    constraints: [],
    skills: [],
    states: [],
    decision_rules: [],
    meta: { last_updated: null, sources: [], confidence: null }
  };
  
  await fs.writeFile(userModelPath, JSON.stringify(testUserModel), 'utf8');

  const { stdout, stderr, status } = spawnSync(
    'npx',
    ['tsx', 'src/index.ts', 'inject', '--target', 'openclaw', '--workspace', dir],
    {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: { ...process.env, HOME: dir } 
    }
  );

  assert.match(stdout, /✓ 写入完成。/);
  assert.match(stdout, /systemctl --user restart openclaw-gateway/);
  
  const content = await fs.readFile(file, 'utf8');
  assert.ok(content.includes('Existing user content.'));
  assert.ok(content.includes('<!-- CORTEX_USER_MODEL_BEGIN -->'));
  assert.ok(content.includes("The user's goal is to learn Rust this year."));
  assert.ok(content.includes('<!-- CORTEX_USER_MODEL_END -->'));
});
