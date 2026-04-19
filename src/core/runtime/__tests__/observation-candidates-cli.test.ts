import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cmdObserve, cmdContext, cmdInject } from '../../../index.js';

class ProcessExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

interface RunResult { status: number; stdout: string; stderr: string; }

function withTmpHome<T>(fn: (tmpHome: string) => T): T {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-cands-'));
  const origHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    return fn(tmpHome);
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

function runCmd(fn: () => void): RunResult {
  let status = 0;
  let stdout = '';
  let stderr = '';
  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;
  process.exit = (code?: number): never => { status = code ?? 0; throw new ProcessExitError(code ?? 0); };
  console.log = (...a: unknown[]) => { stdout += a.map(String).join(' ') + '\n'; };
  console.error = (...a: unknown[]) => { stderr += a.map(String).join(' ') + '\n'; };
  try { fn(); } catch (e) { if (!(e instanceof ProcessExitError)) throw e; }
  finally { process.exit = origExit; console.log = origLog; console.error = origError; }
  return { status, stdout, stderr };
}

describe('CT-0018: cmdObserve — candidate surface 集成', () => {
  it('空日志时行为稳定，不输出 candidate', () => {
    withTmpHome(() => {
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      assert.ok(!r.stdout.includes('[观察发现的稳定模式（供核查候选）]'));
    });
  });

  it('样本不足时不输出 candidate', () => {
    withTmpHome(() => {
      runCmd(() => cmdContext([]));
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      assert.ok(!r.stdout.includes('[观察发现的稳定模式（供核查候选）]'));
    });
  });

  it('足量特定模式样本时输出 candidate，且在最顶层', () => {
    withTmpHome(() => {
      for(let i=0; i<6; i++) {
        runCmd(() => cmdContext(['--scope', 'X']));
      }
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      
      const cIdx = r.stdout.indexOf('[观察发现的稳定模式（供核查候选）]');
      const hIdx = r.stdout.indexOf('[触发提示]');
      const hsIdx = r.stdout.indexOf('[使用健康信号]');
      const rIdx = r.stdout.indexOf('[使用摘要]');
      
      assert.ok(cIdx !== -1, '缺失 candidate 层');
      // 因为都是 scoped context，应该也有其他层
      if (hIdx !== -1) assert.ok(cIdx < hIdx, 'candidate 应在 hints 之前');
      if (hsIdx !== -1) assert.ok(cIdx < hsIdx, 'candidate 应在 health signals 之前');
      if (rIdx !== -1) assert.ok(cIdx < rIdx, 'candidate 应在 recap 之前');
    });
  });

  it('输出包含免责声明', () => {
    withTmpHome(() => {
      for(let i=0; i<6; i++) {
        runCmd(() => cmdContext(['--scope', 'X']));
      }
      const r = runCmd(() => cmdObserve());
      assert.ok(r.stdout.includes('不代表已写入 user model'), '缺失免责声明');
    });
  });
});
