// CT-0013-FIX：cortex context CLI 契约测试
//
// 验证 cmdContext() 参数解析的稳健性：
//   1. 无参数 → all 模式，退出 0
//   2. --scope <value> → scoped 模式，退出 0，输出含 selection summary
//   3. --task-hint <value> → scoped 模式，退出 0，输出含任务线索
//   4. --scope <value> --task-hint <value> → 叠加，退出 0
//   5. --scope 缺参 → fail-fast，非零退出 + stderr 含提示
//   6. --task-hint 缺参 → fail-fast，非零退出 + stderr 含提示
//   7. --scope --task-hint foo → 不误把 --task-hint 当 scope 值，fail-fast
//   8. 未知参数 → fail-fast，非零退出 + stderr 含提示

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cmdContext } from '../index.js';

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

function runContextCommand(args: string[]): RunResult {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ctxtest-'));
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
  console.log = (...a: unknown[]) => { stdout += a.map(String).join(' ') + '\n'; };
  console.error = (...a: unknown[]) => { stderr += a.map(String).join(' ') + '\n'; };
  process.env.HOME = tmpHome;

  try {
    cmdContext(args);
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

describe('CLI: cortex context', () => {
  it('无参数 → all 模式，退出 0，输出含 [User Context]', () => {
    const r = runContextCommand([]);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr=${r.stderr}`);
    assert.ok(r.stdout.includes('[User Context]'), `stdout=${r.stdout}`);
    assert.ok(!r.stdout.includes('[当前上下文范围]'), 'all 模式不应出现 selection summary');
  });

  it('--scope <value> → 退出 0，输出含 selection summary', () => {
    const r = runContextCommand(['--scope', 'Cortex']);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr=${r.stderr}`);
    assert.ok(r.stdout.includes('[User Context]'), `stdout=${r.stdout}`);
    assert.ok(r.stdout.includes('[当前上下文范围]'), 'scoped 模式应含 selection summary');
  });

  it('--task-hint <value> → 退出 0，输出含任务线索', () => {
    const r = runContextCommand(['--task-hint', 'injection']);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr=${r.stderr}`);
    assert.ok(r.stdout.includes('injection'), `stdout=${r.stdout}`);
  });

  it('--scope + --task-hint 叠加 → 退出 0，两者都出现', () => {
    const r = runContextCommand(['--scope', 'Cortex', '--task-hint', 'injection']);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr=${r.stderr}`);
    assert.ok(r.stdout.includes('Cortex'), `stdout=${r.stdout}`);
    assert.ok(r.stdout.includes('injection'), `stdout=${r.stdout}`);
  });

  it('--scope 缺参 → 非零退出，stderr 含 --scope 提示', () => {
    const r = runContextCommand(['--scope']);
    assert.notEqual(r.status, 0, `expected non-zero exit, got ${r.status}`);
    assert.equal(r.stdout.trim(), '', `stdout should be empty, got: ${r.stdout}`);
    assert.match(r.stderr, /--scope/);
  });

  it('--task-hint 缺参 → 非零退出，stderr 含 --task-hint 提示', () => {
    const r = runContextCommand(['--task-hint']);
    assert.notEqual(r.status, 0, `expected non-zero exit, got ${r.status}`);
    assert.equal(r.stdout.trim(), '', `stdout should be empty, got: ${r.stdout}`);
    assert.match(r.stderr, /--task-hint/);
  });

  it('--scope --task-hint foo → fail-fast（不误把 --task-hint 当 scope 值）', () => {
    // If --task-hint is consumed as scope value, we'd get exit 0.
    // Correct behavior: detect --task-hint starts with '--', fail-fast.
    const r = runContextCommand(['--scope', '--task-hint', 'foo']);
    assert.notEqual(r.status, 0, `expected non-zero exit, got ${r.status}`);
    assert.match(r.stderr, /--scope/);
  });

  it('未知参数 → 非零退出，stderr 含参数名', () => {
    const r = runContextCommand(['--unknown-flag']);
    assert.notEqual(r.status, 0, `expected non-zero exit, got ${r.status}`);
    assert.match(r.stderr, /--unknown-flag/);
  });
});
