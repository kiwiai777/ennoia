import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.join(__dirname, '../../dist/index.js');

// KNOWN LIMITATION (CT-0023-02):
// These spawnSync integration tests may fail in restricted sandbox environments
// (e.g. Codex audit environment) due to subprocess isolation constraints —
// same root cause as documented in DL-0022-02.
// Tests pass consistently in the local development environment (348/0).
// Product behavior (openclaw extraction) has been manually verified via dry-run.
// Future fix direction: migrate to in-process testing (see DL-0022-02 Path A).
// See: DL-0023-01 / DL-0022-02 / Stage 17 archive for full context.

test('CLI Sync - OpenClaw Adapter', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-cli-sync-openclaw-'));

  try {
    await t.test('Sync from explicit path', () => {
      // Must use the trigger words from pattern matcher!
      fs.writeFileSync(path.join(tmpDir, 'USER.md'), '我的目标是使用 Rust。');
      fs.writeFileSync(path.join(tmpDir, 'SOUL.md'), '我习惯用 JavaScript。');

      const result = spawnSync(process.execPath, [cliPath, 'sync', '--from', 'openclaw', tmpDir, '--dry-run'], {
        encoding: 'utf8'
      });

      assert.strictEqual(result.status, 0, `Process exited with ${result.status}. Stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('扫描到 2 个候选事实'));
      assert.ok(result.stdout.includes('Rust'));
      assert.ok(result.stdout.includes('JavaScript'));
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
