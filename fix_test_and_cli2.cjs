const fs = require('fs');

let testContent = `
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { injectToOpenClaw } from '../adapters/openclaw/index.js';
import * as storage from '../core/user-model/storage.js';

async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-cli-openclaw-inject-'));
}

test('CLI: cortex inject --target openclaw --dry-run', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'USER.md');
  await fs.writeFile(file, 'Existing user content.\\n', 'utf8');

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
  
  // Mock loadUserModel
  const originalLoad = storage.loadUserModel;
  // @ts-ignore
  storage.loadUserModel = () => testUserModel;
  
  // Mock console.log
  const originalLog = console.log;
  let logs: string[] = [];
  console.log = (msg) => { logs.push(msg); };

  await injectToOpenClaw({ workspacePath: dir, dryRun: true });
  
  console.log = originalLog;
  storage.loadUserModel = originalLoad;

  const stdout = logs.join('\\n');
  assert.match(stdout, /Cortex → OpenClaw \\[dry-run\\]/);
  assert.match(stdout, /注入路径/);
  assert.match(stdout, /--- 注入内容预览 ---/);
  assert.match(stdout, /The user prefers TypeScript over JavaScript for all projects./);
  assert.match(stdout, /The user's goal is to learn Rust this year./);
  assert.match(stdout, /\\[dry-run\\] 未写入/);
  
  // Verify it was really a dry run
  const content = await fs.readFile(file, 'utf8');
  assert.equal(content, 'Existing user content.\\n');
});

test('CLI: cortex inject --target openclaw', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'USER.md');
  await fs.writeFile(file, 'Existing user content.\\n', 'utf8');

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
  
  // Mock loadUserModel
  const originalLoad = storage.loadUserModel;
  // @ts-ignore
  storage.loadUserModel = () => testUserModel;
  
  // Mock console.log
  const originalLog = console.log;
  let logs: string[] = [];
  console.log = (msg) => { logs.push(msg); };

  await injectToOpenClaw({ workspacePath: dir, dryRun: false });

  console.log = originalLog;
  storage.loadUserModel = originalLoad;

  const stdout = logs.join('\\n');
  assert.match(stdout, /✓ 写入完成。/);
  assert.match(stdout, /systemctl --user restart openclaw-gateway/);
  
  const content = await fs.readFile(file, 'utf8');
  assert.ok(content.includes('Existing user content.'));
  assert.ok(content.includes('<!-- CORTEX_USER_MODEL_BEGIN -->'));
  assert.ok(content.includes("The user's goal is to learn Rust this year."));
  assert.ok(content.includes('<!-- CORTEX_USER_MODEL_END -->'));
});
`;

fs.writeFileSync('src/__tests__/cli-inject-openclaw.test.ts', testContent, 'utf8');

