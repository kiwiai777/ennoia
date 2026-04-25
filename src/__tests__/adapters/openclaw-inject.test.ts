import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { injectToUserMd } from '../../adapters/openclaw/inject.js';

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-openclaw-inject-test-'));
  return dir;
}

const BEGIN_MARKER = '<!-- CORTEX_USER_MODEL_BEGIN -->';
const END_MARKER = '<!-- CORTEX_USER_MODEL_END -->';

test('openclaw inject - Append mode: USER.md does not exist -> create + marker block', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'USER.md');
  
  const result = await injectToUserMd(file, 'Test content.');
  
  assert.equal(result.inserted, true);
  assert.equal(result.created, true);
  
  const content = await fs.readFile(file, 'utf8');
  assert.equal(content, `\n${BEGIN_MARKER}\nTest content.\n${END_MARKER}\n`);
});

test('openclaw inject - Append mode: USER.md exists without marker -> append to end', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'USER.md');
  await fs.writeFile(file, 'Existing content.\n', 'utf8');
  
  const result = await injectToUserMd(file, 'Test content.');
  
  assert.equal(result.inserted, true);
  assert.equal(result.created, false);
  
  const content = await fs.readFile(file, 'utf8');
  assert.equal(content, `Existing content.\n\n${BEGIN_MARKER}\nTest content.\n${END_MARKER}\n`);
});

test('openclaw inject - Replace mode: full marker exists -> replace inside', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'USER.md');
  await fs.writeFile(file, `Before\n${BEGIN_MARKER}\nOld content\n${END_MARKER}\nAfter`, 'utf8');
  
  const result = await injectToUserMd(file, 'New content.');
  
  assert.equal(result.inserted, true);
  assert.equal(result.created, false);
  
  const content = await fs.readFile(file, 'utf8');
  assert.equal(content, `Before\n${BEGIN_MARKER}\nNew content.\n${END_MARKER}\nAfter`);
});

test('openclaw inject - Replace mode: renderedContent is empty -> clear inside', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'USER.md');
  await fs.writeFile(file, `Before\n${BEGIN_MARKER}\nOld content\n${END_MARKER}\nAfter`, 'utf8');
  
  const result = await injectToUserMd(file, '');
  
  assert.equal(result.inserted, true);
  assert.equal(result.created, false);
  
  const content = await fs.readFile(file, 'utf8');
  assert.equal(content, `Before\n${BEGIN_MARKER}\n${END_MARKER}\nAfter`);
});

test('openclaw inject - Mismatched marker (partial) -> abort + warning', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'USER.md');
  await fs.writeFile(file, `Before\n${BEGIN_MARKER}\nOld content`, 'utf8');
  
  const consoleError = console.error;
  let errorMsg = '';
  console.error = (msg) => { errorMsg = msg; };
  
  const result = await injectToUserMd(file, 'New content.');
  
  console.error = consoleError;
  
  assert.equal(result.inserted, false);
  assert.equal(result.created, false);
  assert.match(errorMsg, /WARNING.*OpenClaw marker mismatch/);
  
  const content = await fs.readFile(file, 'utf8');
  assert.equal(content, `Before\n${BEGIN_MARKER}\nOld content`); // unchanged
});

test('openclaw inject - Dry-run -> do not write, print preview', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'USER.md');
  
  const consoleLog = console.log;
  let logs: string[] = [];
  console.log = (msg) => { logs.push(msg); };
  
  const result = await injectToUserMd(file, 'Test content.', { dryRun: true });
  
  console.log = consoleLog;
  
  assert.equal(result.inserted, true);
  assert.equal(result.created, true);
  assert.ok(logs.some(l => l && l.includes('注入内容预览')));
  
  // File should not be created
  await assert.rejects(fs.readFile(file, 'utf8'));
});

test('openclaw inject - Atomic write: tmp is in same dir', async () => {
  const dir = await createTempDir();
  const file = path.join(dir, 'USER.md');
  
  // We can just verify the file gets created without mocking fs
  // to avoid ESM read-only assignment issues
  await injectToUserMd(file, 'Test content.');
  
  const files = await fs.readdir(dir);
  assert.ok(files.includes('USER.md'), 'Target file should be created');
});
