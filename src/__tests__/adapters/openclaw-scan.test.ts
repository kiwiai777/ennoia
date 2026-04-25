import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanWorkspace } from '../../adapters/openclaw/scan.js';

test('OpenClaw Adapter - scanWorkspace', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-openclaw-scan-test-'));

  try {
    await t.test('Test 1: USER.md and SOUL.md both exist', async () => {
      fs.writeFileSync(path.join(tmpDir, 'USER.md'), '<!-- CORTEX_USER_MODEL_BEGIN -->\nTo strip\n<!-- CORTEX_USER_MODEL_END -->\nUser goal 1.');
      fs.writeFileSync(path.join(tmpDir, 'SOUL.md'), 'Soul preference 1.');

      const blocks = await scanWorkspace(tmpDir);
      assert.strictEqual(blocks.length, 2);
      
      const userBlock = blocks.find(b => b.path === 'USER.md');
      assert.ok(userBlock);
      assert.strictEqual(userBlock.hint, 'user-profile');
      assert.strictEqual(userBlock.content.includes('User goal 1.'), true);
      assert.strictEqual(userBlock.content.includes('To strip'), false);

      const soulBlock = blocks.find(b => b.path === 'SOUL.md');
      assert.ok(soulBlock);
      assert.strictEqual(soulBlock.hint, 'plain');
      assert.strictEqual(soulBlock.content, 'Soul preference 1.');
    });

    await t.test('Test 2: Only USER.md exists', async () => {
      fs.unlinkSync(path.join(tmpDir, 'SOUL.md'));
      const blocks = await scanWorkspace(tmpDir);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].path, 'USER.md');
    });

    await t.test('Test 3: Neither exists', async () => {
      fs.unlinkSync(path.join(tmpDir, 'USER.md'));
      const blocks = await scanWorkspace(tmpDir);
      assert.strictEqual(blocks.length, 0);
    });

    await t.test('Test 4: Strip marker section completely', async () => {
      fs.writeFileSync(path.join(tmpDir, 'USER.md'), `Hello
<!-- CORTEX_USER_MODEL_BEGIN -->
some content
<!-- CORTEX_USER_MODEL_END -->
World`);
      const blocks = await scanWorkspace(tmpDir);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].content, 'Hello\n\nWorld'); // simplified check
    });

    await t.test('Test 5: Partial markers are not stripped and should emit warning', async () => {
      fs.writeFileSync(path.join(tmpDir, 'USER.md'), `Hello
<!-- CORTEX_USER_MODEL_BEGIN -->
some content
World`);
      
      const origWarn = console.warn;
      let warned = false;
      console.warn = () => { warned = true; };
      
      const blocks = await scanWorkspace(tmpDir);
      console.warn = origWarn;
      
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].content.includes('<!-- CORTEX_USER_MODEL_BEGIN -->'), true);
      assert.strictEqual(warned, true);
    });

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
