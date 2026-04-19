// CT-0016 测试：Usage Health Signals v0.1
//
// 覆盖目标：
//   1. 空 observation log → 无 signals
//   2. 样本不足（< threshold）→ low_sample signal，无其他 signal
//   3. total >= threshold, all >= 80% → mostly_all_mode
//   4. total >= threshold, scoped > 0 → scoped_emerging
//   5. task_hint 出现 → task_hint_used
//   6. 只有单一事件类型（total >= threshold）→ single_event_type
//   7. 多 signal 共存
//   8. cmdObserve: health signals 在 recap / records 之前
//   9. cmdObserve: 不含 user fact inference / 注入正文
//   10. renderHealthSignals 空列表 → 空字符串

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildHealthSignals,
  renderHealthSignals,
  HEALTH_LOW_SAMPLE_THRESHOLD,
  HEALTH_MOSTLY_ALL_RATIO,
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
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-health-'));
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

// N 条相同 observation 的辅助函数
function makeN(n: number, overrides: Partial<RuntimeObservation> = {}): RuntimeObservation[] {
  return Array.from({ length: n }, () => makeObs(overrides));
}

// ── buildHealthSignals 单元测试 ───────────────────────────────────────────────

describe('CT-0016: buildHealthSignals — 空日志', () => {
  it('空列表返回空数组', () => {
    assert.deepEqual(buildHealthSignals([]), []);
  });
});

describe('CT-0016: buildHealthSignals — 样本不足', () => {
  it(`total < ${HEALTH_LOW_SAMPLE_THRESHOLD} → 仅 low_sample signal`, () => {
    const obs = makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1);
    const signals = buildHealthSignals(obs);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].kind, 'low_sample');
    assert.ok(signals[0].message.includes(String(HEALTH_LOW_SAMPLE_THRESHOLD - 1)));
  });

  it('1 条记录 → low_sample signal，不含其他', () => {
    const signals = buildHealthSignals([makeObs()]);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].kind, 'low_sample');
  });

  it(`total = ${HEALTH_LOW_SAMPLE_THRESHOLD} 时不出现 low_sample`, () => {
    const signals = buildHealthSignals(makeN(HEALTH_LOW_SAMPLE_THRESHOLD));
    assert.ok(!signals.some(s => s.kind === 'low_sample'));
  });
});

describe('CT-0016: buildHealthSignals — mostly_all_mode', () => {
  it(`全量比例 >= ${HEALTH_MOSTLY_ALL_RATIO} 时出现 mostly_all_mode`, () => {
    // 8 all + 2 scoped = 80% all（刚好到阈值，total=10 >= threshold）
    const obs = [
      ...makeN(8, { selection_strategy: 'all', event_type: 'context' }),
      ...makeN(2, { selection_strategy: 'scoped', scope: 'X', event_type: 'context' }),
    ];
    const signals = buildHealthSignals(obs);
    assert.ok(signals.some(s => s.kind === 'mostly_all_mode'), `signals=${JSON.stringify(signals)}`);
  });

  it('全量比例 < 0.8 时不出现 mostly_all_mode', () => {
    // 5 all + 5 scoped = 50% all
    const obs = [
      ...makeN(5, { selection_strategy: 'all' }),
      ...makeN(5, { selection_strategy: 'scoped', scope: 'X' }),
    ];
    const signals = buildHealthSignals(obs);
    assert.ok(!signals.some(s => s.kind === 'mostly_all_mode'));
  });

  it('message 含全量次数和总次数', () => {
    const obs = makeN(10, { selection_strategy: 'all', event_type: 'context' });
    const signals = buildHealthSignals(obs);
    const s = signals.find(s => s.kind === 'mostly_all_mode');
    assert.ok(s, 'mostly_all_mode 应存在');
    assert.ok(s!.message.includes('10'), `message=${s!.message}`);
  });
});

describe('CT-0016: buildHealthSignals — scoped_emerging', () => {
  it('至少 1 条 scoped 时出现 scoped_emerging', () => {
    const obs = [
      ...makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1, { selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'scoped', scope: 'Cortex' }),
    ];
    const signals = buildHealthSignals(obs);
    assert.ok(signals.some(s => s.kind === 'scoped_emerging'), `signals=${JSON.stringify(signals)}`);
  });

  it('全部 all 时无 scoped_emerging', () => {
    const obs = makeN(HEALTH_LOW_SAMPLE_THRESHOLD, { selection_strategy: 'all' });
    const signals = buildHealthSignals(obs);
    assert.ok(!signals.some(s => s.kind === 'scoped_emerging'));
  });

  it('message 含 scoped 次数', () => {
    const obs = [
      ...makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1, { selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'scoped', scope: 'X' }),
    ];
    const s = buildHealthSignals(obs).find(s => s.kind === 'scoped_emerging');
    assert.ok(s && s.message.includes('1'), `message=${s?.message}`);
  });
});

describe('CT-0016: buildHealthSignals — task_hint_used', () => {
  it('任一记录有 task_hint → task_hint_used signal', () => {
    const obs = [
      ...makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1, { selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'scoped', scope: 'Cortex', task_hint: 'planning' }),
    ];
    const signals = buildHealthSignals(obs);
    assert.ok(signals.some(s => s.kind === 'task_hint_used'));
  });

  it('无 task_hint 时不出现 task_hint_used', () => {
    const obs = makeN(HEALTH_LOW_SAMPLE_THRESHOLD);
    const signals = buildHealthSignals(obs);
    assert.ok(!signals.some(s => s.kind === 'task_hint_used'));
  });
});

describe('CT-0016: buildHealthSignals — single_event_type', () => {
  it('只有 context（total >= threshold）→ single_event_type', () => {
    const obs = makeN(HEALTH_LOW_SAMPLE_THRESHOLD, { event_type: 'context' });
    const signals = buildHealthSignals(obs);
    assert.ok(signals.some(s => s.kind === 'single_event_type'), `signals=${JSON.stringify(signals)}`);
  });

  it('只有 inject（total >= threshold）→ single_event_type', () => {
    const obs = makeN(HEALTH_LOW_SAMPLE_THRESHOLD, { event_type: 'inject' });
    const signals = buildHealthSignals(obs);
    assert.ok(signals.some(s => s.kind === 'single_event_type'));
  });

  it('context + inject 都有时不出现 single_event_type', () => {
    const obs = [
      ...makeN(3, { event_type: 'context' }),
      ...makeN(3, { event_type: 'inject' }),
    ];
    const signals = buildHealthSignals(obs);
    assert.ok(!signals.some(s => s.kind === 'single_event_type'));
  });
});

describe('CT-0016: buildHealthSignals — 多 signal 共存', () => {
  it('mostly_all + scoped_emerging + task_hint_used 同时存在', () => {
    // 9 all-context + 1 scoped-inject-with-hint = mostly_all(90%) + scoped_emerging + task_hint_used
    const obs = [
      ...makeN(9, { event_type: 'context', selection_strategy: 'all' }),
      makeObs({ event_type: 'inject', selection_strategy: 'scoped', scope: 'X', task_hint: 'planning' }),
    ];
    const signals = buildHealthSignals(obs);
    const kinds = signals.map(s => s.kind);
    assert.ok(kinds.includes('mostly_all_mode'), `kinds=${kinds}`);
    assert.ok(kinds.includes('scoped_emerging'), `kinds=${kinds}`);
    assert.ok(kinds.includes('task_hint_used'), `kinds=${kinds}`);
  });
});

// ── renderHealthSignals 单元测试 ──────────────────────────────────────────────

describe('CT-0016: renderHealthSignals', () => {
  it('空 signals 返回空字符串', () => {
    assert.equal(renderHealthSignals([]), '');
  });

  it('含 [使用健康信号] 标题', () => {
    const s = buildHealthSignals(makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1));
    assert.ok(renderHealthSignals(s).includes('[使用健康信号]'));
  });

  it('每条 signal 以 · 开头', () => {
    const s = buildHealthSignals(makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1));
    const rendered = renderHealthSignals(s);
    assert.ok(rendered.includes('  · '));
  });

  it('不含 user model 推断字段', () => {
    const signals = buildHealthSignals(makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1));
    const rendered = renderHealthSignals(signals);
    assert.ok(!rendered.includes('建议'), `rendered=${rendered}`);
    assert.ok(!rendered.includes('应该'), `rendered=${rendered}`);
    assert.ok(!rendered.includes('推断'), `rendered=${rendered}`);
  });
});

// ── cmdObserve 集成测试 ───────────────────────────────────────────────────────

describe('CT-0016: cmdObserve — health signals 集成', () => {
  it('空日志时不含 [使用健康信号]', () => {
    withTmpHome(() => {
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      assert.ok(!r.stdout.includes('[使用健康信号]'), `stdout=${r.stdout}`);
    });
  });

  it('样本不足时输出 [使用健康信号] 含 low_sample 提示', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject([]));  // 只有 1 条
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      assert.ok(r.stdout.includes('[使用健康信号]'), `stdout=${r.stdout}`);
      assert.ok(r.stdout.includes('样本较少'), `stdout=${r.stdout}`);
    });
  });

  it('health signals 出现在 recap 之前', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject([]));
      const r = runCmd(() => cmdObserve());
      const healthIdx = r.stdout.indexOf('[使用健康信号]');
      const recapIdx = r.stdout.indexOf('[使用摘要]');
      assert.ok(healthIdx !== -1 && recapIdx !== -1, `stdout=${r.stdout}`);
      assert.ok(healthIdx < recapIdx, 'health signals 应在 recap 之前');
    });
  });

  it('health signals 出现在 recent records 之前', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject([]));
      const r = runCmd(() => cmdObserve());
      const healthIdx = r.stdout.indexOf('[使用健康信号]');
      const recordsIdx = r.stdout.indexOf('[最近使用记录]');
      assert.ok(healthIdx !== -1 && recordsIdx !== -1, `stdout=${r.stdout}`);
      assert.ok(healthIdx < recordsIdx, 'health signals 应在 recent records 之前');
    });
  });

  it('足够样本 + scoped 时出现 scoped_emerging signal', () => {
    withTmpHome(() => {
      // 添加足够多的记录：all 模式
      for (let i = 0; i < HEALTH_LOW_SAMPLE_THRESHOLD - 1; i++) {
        runCmd(() => cmdContext([]));
      }
      // 添加 1 条 scoped
      runCmd(() => cmdContext(['--scope', 'Cortex']));
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      assert.ok(r.stdout.includes('已观察到聚焦使用'), `stdout=${r.stdout}`);
    });
  });

  it('task-hint 出现时输出 task_hint_used signal', () => {
    withTmpHome(() => {
      for (let i = 0; i < HEALTH_LOW_SAMPLE_THRESHOLD - 1; i++) {
        runCmd(() => cmdContext([]));
      }
      runCmd(() => cmdContext(['--scope', 'Cortex', '--task-hint', 'planning']));
      const r = runCmd(() => cmdObserve());
      assert.ok(r.stdout.includes('task-hint 使用'), `stdout=${r.stdout}`);
    });
  });

  it('health signals 不含 user fact inference / 注入正文', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject([]));
      const r = runCmd(() => cmdObserve());
      assert.ok(!r.stdout.includes('--- Cortex'), `不应含注入正文: stdout=${r.stdout}`);
      assert.ok(!r.stdout.includes('建议'), `不应含建议推断: stdout=${r.stdout}`);
    });
  });

  it('三层输出（health signals + recap + records）全部存在', () => {
    withTmpHome(() => {
      // 添加足够样本
      for (let i = 0; i < HEALTH_LOW_SAMPLE_THRESHOLD; i++) {
        runCmd(() => cmdContext([]));
      }
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      assert.ok(r.stdout.includes('[使用健康信号]'), `缺 health signals: stdout=${r.stdout}`);
      assert.ok(r.stdout.includes('[使用摘要]'), `缺 recap: stdout=${r.stdout}`);
      assert.ok(r.stdout.includes('[最近使用记录]'), `缺 records: stdout=${r.stdout}`);
    });
  });
});
