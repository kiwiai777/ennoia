// CT-0015 测试：Observation Recap Surface v0.1
//
// 覆盖目标：
//   1. 空日志时 recap 输出稳定
//   2. 只有 context 时的 recap
//   3. 只有 inject 时的 recap
//   4. all / scoped 混合时的 recap
//   5. scope / task_hint 相关 recap
//   6. 原有最近记录列表仍正常显示
//   7. cmdObserve 输出含 recap + 记录列表

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildRecap,
  renderRecap,
  appendObservation,
  type RuntimeObservation,
} from '../observation.js';
import { cmdObserve, cmdInject, cmdContext } from '../../../index.js';

// ── helpers ──────────────────────────────────────────────────────────────────

class ProcessExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

interface RunResult { status: number; stdout: string; stderr: string; }

function withTmpHome<T>(fn: (tmpHome: string) => T): T {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-recap-'));
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

function makeObs(overrides: Partial<RuntimeObservation> = {}): RuntimeObservation {
  return {
    id: 'test-id',
    timestamp: '2026-04-19T10:00:00.000Z',
    event_type: 'context',
    selection_strategy: 'all',
    selected_entries: 1,
    total_entries: 1,
    ...overrides,
  };
}

// ── buildRecap 单元测试 ───────────────────────────────────────────────────────

describe('CT-0015: buildRecap — 空日志', () => {
  it('空列表返回 total=0，所有计数为 0', () => {
    const recap = buildRecap([]);
    assert.equal(recap.total, 0);
    assert.equal(recap.contextCount, 0);
    assert.equal(recap.injectCount, 0);
    assert.equal(recap.allCount, 0);
    assert.equal(recap.scopedCount, 0);
    assert.equal(recap.topScope, undefined);
    assert.equal(recap.hasTaskHint, false);
  });
});

describe('CT-0015: buildRecap — 只有 context', () => {
  it('contextCount 正确，injectCount=0', () => {
    const obs = [
      makeObs({ event_type: 'context' }),
      makeObs({ event_type: 'context' }),
    ];
    const recap = buildRecap(obs);
    assert.equal(recap.total, 2);
    assert.equal(recap.contextCount, 2);
    assert.equal(recap.injectCount, 0);
  });
});

describe('CT-0015: buildRecap — 只有 inject', () => {
  it('injectCount 正确，contextCount=0', () => {
    const obs = [makeObs({ event_type: 'inject' })];
    const recap = buildRecap(obs);
    assert.equal(recap.total, 1);
    assert.equal(recap.contextCount, 0);
    assert.equal(recap.injectCount, 1);
  });
});

describe('CT-0015: buildRecap — all / scoped 混合', () => {
  it('allCount 和 scopedCount 分别统计', () => {
    const obs = [
      makeObs({ selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'scoped', scope: 'Cortex' }),
    ];
    const recap = buildRecap(obs);
    assert.equal(recap.allCount, 2);
    assert.equal(recap.scopedCount, 1);
  });
});

describe('CT-0015: buildRecap — scope 统计', () => {
  it('topScope 返回最高频 scope', () => {
    const obs = [
      makeObs({ selection_strategy: 'scoped', scope: 'Cortex' }),
      makeObs({ selection_strategy: 'scoped', scope: 'Cortex' }),
      makeObs({ selection_strategy: 'scoped', scope: 'OtherProject' }),
    ];
    const recap = buildRecap(obs);
    assert.equal(recap.topScope, 'Cortex');
  });

  it('无 scope 时 topScope=undefined', () => {
    const obs = [makeObs({ selection_strategy: 'all' })];
    const recap = buildRecap(obs);
    assert.equal(recap.topScope, undefined);
  });
});

describe('CT-0015: buildRecap — task_hint', () => {
  it('任一记录有 task_hint 时 hasTaskHint=true', () => {
    const obs = [
      makeObs({ selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'scoped', scope: 'Cortex', task_hint: 'planning' }),
    ];
    const recap = buildRecap(obs);
    assert.equal(recap.hasTaskHint, true);
  });

  it('全无 task_hint 时 hasTaskHint=false', () => {
    const obs = [makeObs(), makeObs()];
    const recap = buildRecap(obs);
    assert.equal(recap.hasTaskHint, false);
  });
});

// ── renderRecap 单元测试 ──────────────────────────────────────────────────────

describe('CT-0015: renderRecap', () => {
  it('空 recap 返回空字符串', () => {
    const result = renderRecap({ total: 0, contextCount: 0, injectCount: 0, allCount: 0, scopedCount: 0, topScope: undefined, hasTaskHint: false });
    assert.equal(result, '');
  });

  it('包含 [使用摘要] 标题', () => {
    const recap = buildRecap([makeObs()]);
    assert.ok(renderRecap(recap).includes('[使用摘要]'));
  });

  it('含 context 计数', () => {
    const recap = buildRecap([makeObs({ event_type: 'context' })]);
    assert.ok(renderRecap(recap).includes('context 1 次'));
  });

  it('含 inject 计数', () => {
    const recap = buildRecap([makeObs({ event_type: 'inject' })]);
    assert.ok(renderRecap(recap).includes('inject 1 次'));
  });

  it('含 全量 计数', () => {
    const recap = buildRecap([makeObs({ selection_strategy: 'all' })]);
    assert.ok(renderRecap(recap).includes('全量 1 次'));
  });

  it('含 聚焦 计数', () => {
    const recap = buildRecap([makeObs({ selection_strategy: 'scoped', scope: 'X' })]);
    assert.ok(renderRecap(recap).includes('聚焦 1 次'));
  });

  it('含 topScope', () => {
    const recap = buildRecap([makeObs({ selection_strategy: 'scoped', scope: 'Cortex' })]);
    assert.ok(renderRecap(recap).includes('Cortex'));
  });

  it('含 task-hint 提示', () => {
    const recap = buildRecap([makeObs({ task_hint: 'planning' })]);
    assert.ok(renderRecap(recap).includes('task-hint'));
  });

  it('无 task_hint 时不含 task-hint 行', () => {
    const recap = buildRecap([makeObs()]);
    assert.ok(!renderRecap(recap).includes('task-hint'));
  });
});

// ── cmdObserve 集成测试 ───────────────────────────────────────────────────────

describe('CT-0015: cmdObserve 输出 recap + 记录列表', () => {
  it('空日志时只输出暂无记录，不崩溃', () => {
    withTmpHome(() => {
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      assert.ok(r.stdout.includes('(No usage records yet)'));
      assert.ok(!r.stdout.includes('[使用摘要]'), '空日志不应有摘要');
    });
  });

  it('有记录时同时输出 recap 和 最近使用记录', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject([]));
      runCmd(() => cmdContext([]));
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
      assert.ok(r.stdout.includes('[使用摘要]'), `缺少 recap: stdout=${r.stdout}`);
      assert.ok(r.stdout.includes('[Recent Usage Records]'), `缺少记录列表: stdout=${r.stdout}`);
    });
  });

  it('recap 出现在记录列表之前', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject([]));
      const r = runCmd(() => cmdObserve());
      const recapIdx = r.stdout.indexOf('[使用摘要]');
      const listIdx = r.stdout.indexOf('[Recent Usage Records]');
      assert.ok(recapIdx < listIdx, 'recap 应在记录列表之前');
    });
  });

  it('recap 含 inject 计数', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject([]));
      const r = runCmd(() => cmdObserve());
      assert.ok(r.stdout.includes('inject 1 次'), `stdout=${r.stdout}`);
    });
  });

  it('recap 含 context 计数', () => {
    withTmpHome(() => {
      runCmd(() => cmdContext([]));
      const r = runCmd(() => cmdObserve());
      assert.ok(r.stdout.includes('context 1 次'), `stdout=${r.stdout}`);
    });
  });

  it('scoped observation 时 recap 含聚焦计数和 topScope', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject(['--scope', 'Cortex']));
      const r = runCmd(() => cmdObserve());
      assert.ok(r.stdout.includes('聚焦 1 次'), `stdout=${r.stdout}`);
      assert.ok(r.stdout.includes('Cortex'), `stdout=${r.stdout}`);
    });
  });

  it('task_hint observation 时 recap 含 task-hint 提示', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject(['--scope', 'Cortex', '--task-hint', 'planning']));
      const r = runCmd(() => cmdObserve());
      assert.ok(r.stdout.includes('task-hint'), `stdout=${r.stdout}`);
    });
  });

  it('recap 不含具体注入正文', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject([]));
      const r = runCmd(() => cmdObserve());
      assert.ok(!r.stdout.includes('--- Cortex'), `recap 不应含注入正文: stdout=${r.stdout}`);
    });
  });
});
