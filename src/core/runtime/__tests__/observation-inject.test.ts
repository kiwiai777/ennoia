import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cmdInject, cmdContext } from '../../../index.js';

class ProcessExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

interface RunResult { status: number; stdout: string; stderr: string; }

function withTmpHome<T>(fn: (tmpHome: string) => T): T {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-inject-obs-'));
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

describe('CT-0019: Observation Recap Injection', () => {
  it('默认不带 --with-observation 时不输出 observation recap block', () => {
    withTmpHome(() => {
      runCmd(() => cmdContext([]));
      const r = runCmd(() => cmdInject([]));
      assert.equal(r.status, 0);
      assert.ok(!r.stdout.includes('[运行时使用摘要（仅供参考）]'));
    });
  });

  it('带 --with-observation 但 observation 为空时不输出 observation recap block', () => {
    withTmpHome(() => {
      const r = runCmd(() => cmdInject(['--with-observation']));
      assert.equal(r.status, 0);
      assert.ok(!r.stdout.includes('[运行时使用摘要（仅供参考）]'));
    });
  });

  it('带 --with-observation 且有内容时，generic agent 能够注入 recap block', () => {
    withTmpHome(() => {
      runCmd(() => cmdContext(['--scope', 'Cortex']));
      const r = runCmd(() => cmdInject(['--with-observation']));
      assert.equal(r.status, 0);
      assert.ok(r.stdout.includes('[运行时使用摘要（仅供参考）]'));
      assert.ok(r.stdout.includes('总记录数：1'));
      assert.ok(r.stdout.includes('context: 1'));
      assert.ok(r.stdout.includes('scoped: 1'));
      assert.ok(r.stdout.includes('Cortex'));
    });
  });

  it('带 --with-observation 且有内容时，claude-code projector 能够注入 recap block', () => {
    withTmpHome(() => {
      runCmd(() => cmdContext(['--scope', 'Cortex', '--task-hint', 'planning']));
      const r = runCmd(() => cmdInject(['--agent', 'claude-code', '--with-observation']));
      assert.equal(r.status, 0);
      assert.ok(r.stdout.includes('[运行时使用摘要（仅供参考）]'));
      assert.ok(r.stdout.includes('总记录数：1'));
      assert.ok(r.stdout.includes('是否包含 task-hint：是'));
    });
  });

  it('未知参数仍 fail-fast', () => {
    withTmpHome(() => {
      const r = runCmd(() => cmdInject(['--with-observation', '--unknown']));
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes('未知的参数 --unknown'));
    });
  });

  it('防回归校验：不会渲染出推断、行动指导等越界措辞', () => {
    withTmpHome(() => {
      runCmd(() => cmdContext(['--scope', 'Cortex']));
      const r = runCmd(() => cmdInject(['--with-observation']));
      assert.ok(!r.stdout.includes('应该'));
      assert.ok(!r.stdout.includes('可尝试'));
      assert.ok(!r.stdout.includes('必要时'));
      assert.ok(!r.stdout.includes('建议'));
      assert.ok(!r.stdout.includes('系统判断'));
      assert.ok(!r.stdout.includes('匹配当前任务'));
    });
  });

  it('--format json --with-observation 不污染 JSON pack 契约', () => {
    withTmpHome(() => {
      runCmd(() => cmdContext(['--scope', 'Cortex']));
      const r = runCmd(() => cmdInject(['--format', 'json', '--with-observation']));
      assert.equal(r.status, 0);

      const pack = JSON.parse(r.stdout);
      assert.equal(pack.version, '0.1');
      assert.ok(pack.generated_at);
      assert.ok(pack.source);
      assert.ok(pack.user_summary);
      assert.ok(Array.isArray(pack.entries));
      assert.ok(pack.instructions);

      // 确保没有注入 observation 相关字段
      assert.equal(pack.observation, undefined);
      assert.equal(pack.observation_recap, undefined);
      assert.equal(pack.runtime_recap, undefined);
      assert.equal(pack.recap_text, undefined);
    });
  });

  it('--format json --with-observation --agent claude-code 也不污染 JSON pack 契约', () => {
    withTmpHome(() => {
      runCmd(() => cmdContext(['--scope', 'Cortex']));
      const r = runCmd(() => cmdInject(['--format', 'json', '--with-observation', '--agent', 'claude-code']));
      assert.equal(r.status, 0);

      const pack = JSON.parse(r.stdout);
      assert.equal(pack.version, '0.1');
      assert.equal(pack.source.agent, 'claude-code');

      // 确保没有注入 observation 相关字段
      assert.equal(pack.observation, undefined);
      assert.equal(pack.observation_recap, undefined);
      assert.equal(pack.runtime_recap, undefined);
      assert.equal(pack.recap_text, undefined);
    });
  });
});
