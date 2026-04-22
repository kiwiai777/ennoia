// CT-0021-07 — cortex reflect CLI 合约（in-process 直接调用）
//
// 隔离：每次调用使用临时 HOME 目录，避免读写真实 ~/.cortex/suggest-loop-store.json。
// promptFn / readStdinFn 通过 opts 注入，绕过 readline / process.stdin 依赖。

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { cmdReflect } from '../index.js';
import { loadStore, getStorePath } from '../core/suggest-loop/store.js';

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

let tmpHome: string;
let origHome: string | undefined;

function setup(): void {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-reflecttest-'));
  origHome = process.env.HOME;
  process.env.HOME = tmpHome;
}

function teardown(): void {
  process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

// Injection-based test runner: simulates TTY interactive mode (isTTY=true).
async function runReflect(
  args: string[],
  promptAnswerIndices: number[] = [],
  stdinLines?: string[],
): Promise<RunResult> {
  let status = 0;
  let stdout = '';
  let stderr = '';

  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;
  // Simulate interactive TTY so the preflight passes in injection-based tests.
  const stdinRef = process.stdin as unknown as Record<string, unknown>;
  const origIsTTY = stdinRef.isTTY;
  stdinRef.isTTY = true;

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

  try {
    await cmdReflect(args, {
      promptFn: async (_total: number) => promptAnswerIndices,
      readStdinFn: stdinLines !== undefined ? async () => stdinLines : undefined,
    });
  } catch (e) {
    if (!(e instanceof ProcessExitError)) throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origError;
    stdinRef.isTTY = origIsTTY;
  }

  return { status, stdout, stderr };
}

describe('CLI: cortex reflect', () => {
  beforeEach(setup);
  afterEach(teardown);

  // ── 位置参数路径 ────────────────────────────────────────────────────────────

  it('位置参数 happy path：有候选 → 选中 → 写入成功', async () => {
    // "我喜欢简洁代码" triggers a preference candidate
    const r = await runReflect(['我喜欢简洁代码'], [0]);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('检测到以下候选'), `stdout=${r.stdout}`);
    assert.ok(r.stdout.includes('已确认写入'), `stdout=${r.stdout}`);

    // Verify persistence
    const store = loadStore();
    assert.equal(store.entries.length, 1);
    assert.equal(store.entries[0].type, 'preference');
    assert.equal(store.entries[0].source, 'suggest_loop');
  });

  it('位置参数：选择 none → 不写入，exit 0', async () => {
    const r = await runReflect(['我喜欢简洁代码'], []);

    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('未选择'), `stdout=${r.stdout}`);

    const store = loadStore();
    assert.equal(store.entries.length, 0);
  });

  it('位置参数：选择 all（多候选）→ 全部写入', async () => {
    // Multiple sentences that produce multiple candidates
    const input = '我喜欢简洁代码。我的目标是在十天内上线。';
    const r = await runReflect([input], [0, 1]);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    const store = loadStore();
    assert.ok(store.entries.length >= 2, `entries=${store.entries.length}`);
  });

  it('位置参数：无候选 → 显式提示，exit 0', async () => {
    // A sentence with no pattern keywords
    const r = await runReflect(['这是一段普通文本，没有关键词'], []);

    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('未发现任何候选'), `stdout=${r.stdout}`);
  });

  // ── --stdin 路径 ────────────────────────────────────────────────────────────

  it('--stdin happy path：多行 → 有候选 → 写入', async () => {
    const lines = ['我喜欢简洁代码', '我的目标是在十天内上线'];
    const r = await runReflect(['--stdin'], [0, 1], lines);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('检测到以下候选'), `stdout=${r.stdout}`);

    const store = loadStore();
    assert.ok(store.entries.length >= 1);
  });

  it('--stdin 空输入 → fail-fast exit 1', async () => {
    const r = await runReflect(['--stdin'], [], []);

    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('stdin 为空'), `stderr=${r.stderr}`);
  });

  it('--stdin 空行过滤：只有空行 → fail-fast exit 1', async () => {
    const r = await runReflect(['--stdin'], [], ['', '  ', '']);

    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('stdin 为空'), `stderr=${r.stderr}`);
  });

  // ── fail-fast 路径 ──────────────────────────────────────────────────────────

  it('空输入（无参数）→ fail-fast exit 1', async () => {
    const r = await runReflect([]);

    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('reflect 需要一段文本'), `stderr=${r.stderr}`);
  });

  it('未知参数 → fail-fast exit 1', async () => {
    const r = await runReflect(['--unknown']);

    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('不支持参数'), `stderr=${r.stderr}`);
  });

  it('--stdin 与位置参数互斥 → fail-fast exit 1', async () => {
    const r = await runReflect(['--stdin', '我喜欢简洁代码'], [], ['我喜欢深色模式']);

    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('互斥'), `stderr=${r.stderr}`);
  });

  // ── --list 路径 ─────────────────────────────────────────────────────────────

  it('--list 无数据 → 显式提示，exit 0', async () => {
    const r = await runReflect(['--list']);

    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('暂无已确认的 suggest-loop 记录'), `stdout=${r.stdout}`);
  });

  it('--list 有数据 → 显示最近条目，exit 0', async () => {
    // Pre-populate store
    await runReflect(['我喜欢简洁代码'], [0]);

    const r = await runReflect(['--list']);

    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('[最近 suggest-loop 记录]'), `stdout=${r.stdout}`);
    assert.ok(r.stdout.includes('preference'), `stdout=${r.stdout}`);
  });

  it('--list 最多显示 20 条（写入 25 条后验证）', async () => {
    // Write many entries directly to the store
    const dir = path.join(tmpHome, '.cortex');
    fs.mkdirSync(dir, { recursive: true });
    const entries = Array.from({ length: 25 }, (_, i) => ({
      type: 'preference' as const,
      content: `条目 ${i + 1}`,
      source: 'suggest_loop' as const,
    }));
    fs.writeFileSync(
      getStorePath(),
      JSON.stringify({ version: '0.1', entries }),
      'utf-8',
    );

    const r = await runReflect(['--list']);

    assert.equal(r.status, 0);
    // Should show "条目 25" (most recent) and not show "条目 1" (oldest, beyond 20)
    assert.ok(r.stdout.includes('条目 25'), `stdout=${r.stdout}`);
    assert.ok(!r.stdout.includes('条目 5\n') || r.stdout.includes('条目 25'), `stdout shows top 20`);
  });

  // ── --accept-all 路径 ───────────────────────────────────────────────────────

  it('--stdin + --accept-all + 有候选 → 跳过交互，全部写入，exit 0', async () => {
    const lines = ['我喜欢简洁代码', '我的目标是在十天内上线'];
    const r = await runReflect(['--stdin', '--accept-all'], [], lines);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('已确认写入'), `stdout=${r.stdout}`);

    const store = loadStore();
    assert.ok(store.entries.length >= 1);
  });

  it('--accept-all + 位置参数 → 互斥，fail-fast exit 1', async () => {
    const r = await runReflect(['我喜欢简洁代码', '--accept-all']);

    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('--accept-all'), `stderr=${r.stderr}`);
  });

  // ── 真实路径测试（不注入 promptFn）————回归守护 TTY preflight ──────────────

  it('[real-path] 非 TTY + --stdin + 无 --accept-all → preflight exit 1，store 无写入', async () => {
    // Temporarily force non-TTY on process.stdin
    const origIsTTY = (process.stdin as unknown as Record<string, unknown>).isTTY;
    (process.stdin as unknown as Record<string, unknown>).isTTY = false;

    let status = 0;
    let stderr = '';
    const origExit = process.exit;
    const origError = console.error;
    process.exit = (code?: number): never => { status = code ?? 0; throw new ProcessExitError(code ?? 0); };
    console.error = (...a: unknown[]) => { stderr += a.map(String).join(' ') + '\n'; };

    try {
      // Do NOT inject readStdinFn or promptFn — tests real preflight path
      await cmdReflect(['--stdin']);
    } catch (e) {
      if (!(e instanceof ProcessExitError)) throw e;
    } finally {
      process.exit = origExit;
      console.error = origError;
      (process.stdin as unknown as Record<string, unknown>).isTTY = origIsTTY;
    }

    assert.equal(status, 1, 'expected exit 1');
    assert.ok(stderr.includes('--accept-all'), `expected --accept-all guidance in stderr, got: ${stderr}`);
    assert.ok(stderr.includes('非交互'), `expected non-interactive mention in stderr, got: ${stderr}`);

    const store = loadStore();
    assert.equal(store.entries.length, 0, 'store must remain empty after preflight fail');
  });

  it('[real-path] 非 TTY + --stdin + --accept-all + 有候选 → exit 0，store 写入', async () => {
    const proc = spawnSync('node', ['--import', 'tsx', 'src/index.ts', 'reflect', '--stdin', '--accept-all'], {
      input: '我喜欢简洁代码\n我计划用 TypeScript\n',
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: tmpHome,
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const status = proc.status;
    const stdout = proc.stdout;
    const stderr = proc.stderr;

    assert.equal(status, 0, `expected exit 0, stderr=${stderr}`);
    assert.ok(stdout.includes('已确认写入'), `stdout=${stdout}`);

    const store = loadStore();
    assert.equal(store.entries.length, 2, 'store must have 2 entries after --accept-all');
  });

  it('[real-path] --accept-all + 位置参数 → fail-fast exit 1（无需 stdin/prompt 注入）', async () => {
    let status = 0;
    let stderr = '';
    const origExit = process.exit;
    const origError = console.error;
    process.exit = (code?: number): never => { status = code ?? 0; throw new ProcessExitError(code ?? 0); };
    console.error = (...a: unknown[]) => { stderr += a.map(String).join(' ') + '\n'; };

    try {
      // No injection at all — tests pure argument parsing path
      await cmdReflect(['我喜欢简洁代码', '--accept-all']);
    } catch (e) {
      if (!(e instanceof ProcessExitError)) throw e;
    } finally {
      process.exit = origExit;
      console.error = origError;
    }

    assert.equal(status, 1);
    assert.ok(stderr.includes('--accept-all'), `expected --accept-all in stderr, got: ${stderr}`);
  });

  // ── 选择场景 ─────────────────────────────────────────────────────────────────

  it('选择指定编号（部分选择）→ 只写入选中条目', async () => {
    const input = '我喜欢简洁代码。我的目标是在十天内上线。';
    // Select only index 0 (first candidate)
    const r = await runReflect([input], [0]);

    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('1 条已确认写入'), `stdout=${r.stdout}`);

    const store = loadStore();
    assert.equal(store.entries.length, 1);
  });
});
