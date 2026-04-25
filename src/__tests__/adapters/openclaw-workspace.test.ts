import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveWorkspacePath } from '../../adapters/openclaw/workspace.js';

test('OpenClaw Adapter - resolveWorkspacePath', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-openclaw-ws-test-'));
  const configDir = path.join(tmpDir, '.openclaw');
  const wsDir = path.join(tmpDir, 'workspace');
  fs.mkdirSync(configDir);
  fs.mkdirSync(wsDir);

  const realHomedir = os.homedir;

  try {
    await t.test('Explicit path prioritized', () => {
      const res = resolveWorkspacePath(wsDir);
      assert.strictEqual(res, path.resolve(wsDir));
    });

    await t.test('OpenClaw config parsing', () => {
      // Mock homedir to point to our tmpDir
      os.homedir = () => tmpDir;
      
      fs.writeFileSync(path.join(configDir, 'openclaw.json'), JSON.stringify({
        agents: { defaults: { workspace: wsDir } }
      }));
      
      const res = resolveWorkspacePath();
      assert.strictEqual(res, path.resolve(wsDir));
    });

    await t.test('Config not found throws', () => {
      fs.unlinkSync(path.join(configDir, 'openclaw.json'));
      assert.throws(() => resolveWorkspacePath(), /OpenClaw config not found/);
    });

    await t.test('Field missing throws', () => {
      fs.writeFileSync(path.join(configDir, 'openclaw.json'), JSON.stringify({}));
      assert.throws(() => resolveWorkspacePath(), /not configured/);
    });

    await t.test('Throws when path is not a directory', () => {
      const tmpFile = path.join(tmpDir, 'not-a-dir.txt');
      fs.writeFileSync(tmpFile, '');
      assert.throws(() => resolveWorkspacePath(tmpFile), /not a directory/i);
    });

  } finally {
    os.homedir = realHomedir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
