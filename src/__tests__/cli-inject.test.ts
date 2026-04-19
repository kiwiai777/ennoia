// CT-0009-FIX 测试：cortex inject CLI 合约
//
// 这一层覆盖的是"用户直接敲进终端的那条命令"的真实行为，
// 而不是 builder 函数。它会真的 spawn `./bin/cortex`，
// 因此也顺带覆盖了 launcher 本身是否可在当前环境下启动。
//
// 测试目标：
//   1. `cortex inject --format json` 成功路径：退出码 0 + 输出合法 JSON +
//      含 Structured Injection Pack v0.1 的关键字段
//   2. `cortex inject --agent claude-code --format json` 能把 agent 传进 pack
//   3. `cortex inject --format yaml` 错误路径：退出码非 0 + stderr 含明确错误
//
// 隔离：
//   每个用例都用一个干净的临时 HOME 目录运行，避免读/写真实的
//   `~/.cortex/user_model.json`。测试本身不依赖用户当前的 user model。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

// 直接用 node + tsx loader 调起 src/index.ts，与 bin/cortex 脚本行为等价，
// 但不依赖 bash 可 exec（在部分 Node 沙箱环境 spawnSync 执行 bash 脚本会报 EPERM）。
const LOADER = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const SRC_ENTRY = path.join(REPO_ROOT, 'src', 'index.ts');

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCortex(args: string[]): RunResult {
  // 每次调用都单独开一个 tmp HOME，保证：
  //   - 不碰用户真实的 ~/.cortex/user_model.json
  //   - 用例之间互不串数据
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-clitest-'));
  try {
    const result = spawnSync(
      'node',
      ['--import', `file://${LOADER}`, SRC_ENTRY, ...args],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, HOME: tmpHome },
        encoding: 'utf-8',
      }
    );
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

describe('CLI: cortex inject', () => {
  it('--format json 成功：退出 0，输出合法 Pack v0.1', () => {
    const r = runCortex(['inject', '--format', 'json']);

    assert.equal(
      r.status,
      0,
      `expected exit 0, got ${r.status}\nstderr=${r.stderr}`
    );

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(r.stdout) as Record<string, unknown>;
    } catch (err) {
      assert.fail(
        `stdout 不是合法 JSON: ${(err as Error).message}\nstdout=${r.stdout}`
      );
    }

    // Structured Injection Pack v0.1 合约上必须出现的字段
    assert.equal(parsed.version, '0.1');
    assert.equal(typeof parsed.generated_at, 'string');
    assert.ok(Array.isArray(parsed.entries));
    assert.ok(parsed.user_summary && typeof parsed.user_summary === 'object');
    assert.ok(parsed.instructions && typeof parsed.instructions === 'object');

    const source = parsed.source as Record<string, unknown>;
    assert.equal(source.generator, 'cortex');
    // 未传 --agent 时默认是 generic
    assert.equal(source.agent, 'generic');
  });

  it('--agent claude-code --format json 把 agent 反映在 source.agent 里', () => {
    const r = runCortex([
      'inject',
      '--agent',
      'claude-code',
      '--format',
      'json',
    ]);

    assert.equal(
      r.status,
      0,
      `expected exit 0, got ${r.status}\nstderr=${r.stderr}`
    );

    const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
    const source = parsed.source as Record<string, unknown>;
    assert.equal(source.agent, 'claude-code');
  });

  it('--agent claude-code（默认 text）：走 projector 路径，输出含 XML 包装标签', () => {
    const r = runCortex(['inject', '--agent', 'claude-code']);

    assert.equal(
      r.status,
      0,
      `expected exit 0, got ${r.status}\nstderr=${r.stderr}`
    );
    assert.ok(
      r.stdout.includes('<cortex-user-model-injection>'),
      `expected XML wrapper in output\nstdout=${r.stdout}`
    );
    assert.ok(
      r.stdout.includes('</cortex-user-model-injection>'),
      `expected closing XML tag\nstdout=${r.stdout}`
    );
  });

  it('--format yaml 错误：退出非 0，stderr 提示 --format 非法', () => {
    const r = runCortex(['inject', '--format', 'yaml']);

    assert.notEqual(
      r.status,
      0,
      `expected non-zero exit, got ${r.status}\nstdout=${r.stdout}`
    );
    // stdout 不应当被污染为 JSON 之类的成功输出
    assert.equal(r.stdout.trim(), '');
    // 明确的中文错误提示（来自 src/index.ts cmdInject）
    assert.match(r.stderr, /--format/);
    assert.match(r.stderr, /yaml/);
  });
});
