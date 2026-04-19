// CT-0010-FIX2：cortex inject CLI 合约（in-process 直接调用）
//
// 测试仍然验证完整的 CLI 合约：
//   - 参数解析（--agent / --format）
//   - 路由逻辑（json / text / claude-code projector）
//   - stdout 输出格式
//   - 错误处理（非法 --format → 非零退出 + stderr 提示）
//
// 与前一版本的区别：
//   不再 spawn 子进程（subprocess 在部分沙箱审计环境下被 EPERM 拒绝）。
//   改为直接 import cmdInject，在进程内 mock process.exit / console.log /
//   console.error，并用临时 HOME 目录隔离 user model 读写。
//   bash 启动器（bin/cortex）是透传层，不影响 CLI 合约验证。
//
// 测试目标：
//   1. `inject --format json` 成功路径：退出 0 + 输出合法 Pack v0.1 JSON
//   2. `inject --agent claude-code --format json` agent 透传路径
//   3. `inject --agent claude-code`（默认 text）走 projector，输出 XML 标签
//   4. `inject --format yaml` 错误路径：退出非 0 + stderr 含明确提示
//
// 隔离：
//   每次调用都用临时 HOME 目录运行，避免读写真实 ~/.cortex/user_model.json。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cmdInject } from '../index.js';

class ProcessExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runInjectCommand(args: string[]): RunResult {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-injecttest-'));
  const origHome = process.env.HOME;

  let status = 0;
  let stdout = '';
  let stderr = '';

  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;

  process.exit = (code?: number): never => {
    status = code ?? 0;
    throw new ProcessExitError(code ?? 0);
  };

  console.log = (...a: unknown[]) => {
    stdout += a.map(String).join(' ') + '\n';
  };
  console.error = (...a: unknown[]) => {
    stderr += a.map(String).join(' ') + '\n';
  };

  process.env.HOME = tmpHome;

  try {
    cmdInject(args);
  } catch (e) {
    if (!(e instanceof ProcessExitError)) throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origError;
    process.env.HOME = origHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }

  return { status, stdout, stderr };
}

describe('CLI: cortex inject', () => {
  it('--format json 成功：退出 0，输出合法 Pack v0.1', () => {
    const r = runInjectCommand(['--format', 'json']);

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

    assert.equal(parsed.version, '0.1');
    assert.equal(typeof parsed.generated_at, 'string');
    assert.ok(Array.isArray(parsed.entries));
    assert.ok(parsed.user_summary && typeof parsed.user_summary === 'object');
    assert.ok(parsed.instructions && typeof parsed.instructions === 'object');

    const source = parsed.source as Record<string, unknown>;
    assert.equal(source.generator, 'cortex');
    assert.equal(source.agent, 'generic');
  });

  it('--agent claude-code --format json 把 agent 反映在 source.agent 里', () => {
    const r = runInjectCommand(['--agent', 'claude-code', '--format', 'json']);

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
    const r = runInjectCommand(['--agent', 'claude-code']);

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
    const r = runInjectCommand(['--format', 'yaml']);

    assert.notEqual(
      r.status,
      0,
      `expected non-zero exit, got ${r.status}\nstdout=${r.stdout}`
    );
    assert.equal(r.stdout.trim(), '');
    assert.match(r.stderr, /--format/);
    assert.match(r.stderr, /yaml/);
  });
});
