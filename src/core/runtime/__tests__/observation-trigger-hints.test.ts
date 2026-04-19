// CT-0017 测试：Runtime Trigger Hints Foundation v0.1
//
// 覆盖目标：
//   1. 空 observation log → 无 hints
//   2. 样本不足（< threshold）→ 无 hints
//   3. scoped >= 1 → focused_pattern_observed
//   4. hasTaskHint → focused_pattern_observed
//   5. scoped/total >= 0.3 → focused_mode_shifting
//   6. inject/total >= 0.5 → inject_pattern_observed
//   7. 多 hint 共存
//   8. 全 all 模式 / 无 scoped / 无 task-hint → 无 focused_pattern_observed / focused_mode_shifting
//   9. renderTriggerHints 空列表 → 空字符串
//   10. hints 仅为观察性信号，不包含建议性提示
//   11. cmdObserve: trigger hints 在 health signals 之前
//   12. cmdObserve: 四层输出共存
//   13. cmdObserve: 不含 user fact inference / 注入正文

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildTriggerHints,
  renderTriggerHints,
  HINT_SCOPED_RATIO_THRESHOLD,
  HINT_INJECT_RATIO_THRESHOLD,
  HEALTH_LOW_SAMPLE_THRESHOLD,
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
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-hints-'));
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

function makeN(n: number, overrides: Partial<RuntimeObservation> = {}): RuntimeObservation[] {
  return Array.from({ length: n }, () => makeObs(overrides));
}

// ── buildTriggerHints 单元测试 ────────────────────────────────────────────────

describe('CT-0017: buildTriggerHints — 空日志', () => {
  it('空列表返回空数组', () => {
    assert.deepEqual(buildTriggerHints([]), []);
  });
});

describe('CT-0017: buildTriggerHints — 样本不足', () => {
  it(`total < ${HEALTH_LOW_SAMPLE_THRESHOLD} → 无 hints`, () => {
    const obs = makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1);
    assert.deepEqual(buildTriggerHints(obs), []);
  });

  it(`total = ${HEALTH_LOW_SAMPLE_THRESHOLD} 时才开始给 hints`, () => {
    // 5 inject 全 inject → refresh_inject_for_task（inject占比100%）
    const obs = makeN(HEALTH_LOW_SAMPLE_THRESHOLD, { event_type: 'inject' });
    const hints = buildTriggerHints(obs);
    assert.ok(hints.length > 0, '足够样本时应有 hints');
  });
});

describe('CT-0017: buildTriggerHints — focused_pattern_observed', () => {
  it('scoped >= 1 时出现 focused_pattern_observed', () => {
    const obs = [
      ...makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1, { selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'scoped', scope: 'Cortex' }),
    ];
    const hints = buildTriggerHints(obs);
    assert.ok(hints.some(h => h.kind === 'focused_pattern_observed'), `hints=${JSON.stringify(hints)}`);
  });

  it('hasTaskHint 时出现 focused_pattern_observed', () => {
    const obs = [
      ...makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1, { selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'all', task_hint: 'planning' }),
    ];
    const hints = buildTriggerHints(obs);
    assert.ok(hints.some(h => h.kind === 'focused_pattern_observed'), `hints=${JSON.stringify(hints)}`);
  });

  it('全 all 且无 task-hint → 无 focused_pattern_observed', () => {
    const obs = makeN(HEALTH_LOW_SAMPLE_THRESHOLD, { selection_strategy: 'all' });
    const hints = buildTriggerHints(obs);
    assert.ok(!hints.some(h => h.kind === 'focused_pattern_observed'));
  });
});

describe('CT-0017: buildTriggerHints — focused_mode_shifting', () => {
  it(`scoped/total >= ${HINT_SCOPED_RATIO_THRESHOLD} 时出现 focused_mode_shifting`, () => {
    // 5 all + 3 scoped = 3/8 = 0.375 >= 0.3
    const obs = [
      ...makeN(5, { selection_strategy: 'all' }),
      ...makeN(3, { selection_strategy: 'scoped', scope: 'X' }),
    ];
    const hints = buildTriggerHints(obs);
    assert.ok(hints.some(h => h.kind === 'focused_mode_shifting'), `hints=${JSON.stringify(hints)}`);
  });

  it(`scoped/total < ${HINT_SCOPED_RATIO_THRESHOLD} 时不出现 focused_mode_shifting`, () => {
    // 9 all + 1 scoped = 1/10 = 0.1 < 0.3
    const obs = [
      ...makeN(9, { selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'scoped', scope: 'X' }),
    ];
    const hints = buildTriggerHints(obs);
    assert.ok(!hints.some(h => h.kind === 'focused_mode_shifting'), `hints=${JSON.stringify(hints)}`);
  });

  it('全 all 模式 → 无 focused_mode_shifting', () => {
    const obs = makeN(HEALTH_LOW_SAMPLE_THRESHOLD, { selection_strategy: 'all' });
    const hints = buildTriggerHints(obs);
    assert.ok(!hints.some(h => h.kind === 'focused_mode_shifting'));
  });
});

describe('CT-0017: buildTriggerHints — inject_pattern_observed', () => {
  it(`inject/total >= ${HINT_INJECT_RATIO_THRESHOLD} 时出现 inject_pattern_observed`, () => {
    // 3 inject + 2 context = 3/5 = 0.6 >= 0.5
    const obs = [
      ...makeN(3, { event_type: 'inject' }),
      ...makeN(2, { event_type: 'context' }),
    ];
    const hints = buildTriggerHints(obs);
    assert.ok(hints.some(h => h.kind === 'inject_pattern_observed'), `hints=${JSON.stringify(hints)}`);
  });

  it(`inject/total < ${HINT_INJECT_RATIO_THRESHOLD} 时不出现 inject_pattern_observed`, () => {
    // 2 inject + 8 context = 2/10 = 0.2 < 0.5
    const obs = [
      ...makeN(2, { event_type: 'inject' }),
      ...makeN(8, { event_type: 'context' }),
    ];
    const hints = buildTriggerHints(obs);
    assert.ok(!hints.some(h => h.kind === 'inject_pattern_observed'), `hints=${JSON.stringify(hints)}`);
  });

  it('全 context 且无 inject → 无 inject_pattern_observed', () => {
    const obs = makeN(HEALTH_LOW_SAMPLE_THRESHOLD, { event_type: 'context' });
    const hints = buildTriggerHints(obs);
    assert.ok(!hints.some(h => h.kind === 'inject_pattern_observed'));
  });
});

describe('CT-0017: buildTriggerHints — 多 hint 共存', () => {
  it('scoped + inject 占比高时多 hint 同时出现', () => {
    // 3 inject-scoped + 3 inject-all + 2 context-all = total 8
    // inject: 6/8=0.75 >= 0.5 → inject_pattern_observed
    // scoped: 3/8=0.375 >= 0.3 → focused_mode_shifting
    // scopedCount >= 1 → focused_pattern_observed
    const obs = [
      ...makeN(3, { event_type: 'inject', selection_strategy: 'scoped', scope: 'X' }),
      ...makeN(3, { event_type: 'inject', selection_strategy: 'all' }),
      ...makeN(2, { event_type: 'context', selection_strategy: 'all' }),
    ];
    const hints = buildTriggerHints(obs);
    const kinds = hints.map(h => h.kind);
    assert.ok(kinds.includes('focused_pattern_observed'), `kinds=${kinds}`);
    assert.ok(kinds.includes('focused_mode_shifting'), `kinds=${kinds}`);
    assert.ok(kinds.includes('inject_pattern_observed'), `kinds=${kinds}`);
  });
});

// ── renderTriggerHints 单元测试 ───────────────────────────────────────────────

describe('CT-0017: renderTriggerHints', () => {
  it('空 hints 返回空字符串', () => {
    assert.equal(renderTriggerHints([]), '');
  });

  it('含 [触发提示] 标题', () => {
    const obs = [
      ...makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1, { selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'scoped', scope: 'X' }),
    ];
    const rendered = renderTriggerHints(buildTriggerHints(obs));
    assert.ok(rendered.includes('[触发提示]'), `rendered=${rendered}`);
  });

  it('每条 hint 以 · 开头', () => {
    const obs = [
      ...makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1, { selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'scoped', scope: 'X' }),
    ];
    const rendered = renderTriggerHints(buildTriggerHints(obs));
    assert.ok(rendered.includes('  · '), `rendered=${rendered}`);
  });

  it('hints 仅为观察性信号，不包含建议性提示', () => {
    const obs = [
      ...makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1, { selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'scoped', scope: 'X' }),
    ];
    const rendered = renderTriggerHints(buildTriggerHints(obs));
    assert.ok(!rendered.includes('可尝试'), `rendered=${rendered}`);
    assert.ok(!rendered.includes('必要时'), `rendered=${rendered}`);
    assert.ok(!rendered.includes('查看 context'), `rendered=${rendered}`);
    assert.ok(!rendered.includes('重新生成'), `rendered=${rendered}`);
    assert.ok(!rendered.includes('关键任务前'), `rendered=${rendered}`);
  });

  it('不含 recommendation 措辞', () => {
    const obs = [
      ...makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1),
      makeObs({ selection_strategy: 'scoped', scope: 'X' }),
    ];
    const rendered = renderTriggerHints(buildTriggerHints(obs));
    assert.ok(!rendered.includes('建议你'), `rendered=${rendered}`);
    assert.ok(!rendered.includes('应该'), `rendered=${rendered}`);
    assert.ok(!rendered.includes('推断'), `rendered=${rendered}`);
  });
});

// ── cmdObserve 集成测试 ───────────────────────────────────────────────────────

describe('CT-0017: cmdObserve — trigger hints 集成', () => {
  it('空日志时不含 [触发提示]', () => {
    withTmpHome(() => {
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      assert.ok(!r.stdout.includes('[触发提示]'), `stdout=${r.stdout}`);
    });
  });

  it('样本不足时不含 [触发提示]', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject([]));  // 只有 1 条
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      assert.ok(!r.stdout.includes('[触发提示]'), `stdout=${r.stdout}`);
    });
  });

  it('足量 inject 样本时出现 inject_pattern_observed hint', () => {
    withTmpHome(() => {
      // 3 inject + 2 context = inject 占比 60%
      runCmd(() => cmdInject([]));
      runCmd(() => cmdInject([]));
      runCmd(() => cmdInject([]));
      runCmd(() => cmdContext([]));
      runCmd(() => cmdContext([]));
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      assert.ok(r.stdout.includes('[触发提示]'), `stdout=${r.stdout}`);
      assert.ok(r.stdout.includes('inject 使用占比较高'), `stdout=${r.stdout}`);
    });
  });

  it('scoped 出现时包含 focused_pattern_observed hint', () => {
    withTmpHome(() => {
      for (let i = 0; i < HEALTH_LOW_SAMPLE_THRESHOLD - 1; i++) {
        runCmd(() => cmdContext([]));
      }
      runCmd(() => cmdContext(['--scope', 'Cortex']));
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      assert.ok(r.stdout.includes('[触发提示]'), `stdout=${r.stdout}`);
      assert.ok(r.stdout.includes('聚焦使用模式已出现'), `stdout=${r.stdout}`);
    });
  });

  it('trigger hints 出现在 health signals 之前', () => {
    withTmpHome(() => {
      // 5 context (all) + inject makes health signal and hint
      for (let i = 0; i < HEALTH_LOW_SAMPLE_THRESHOLD; i++) {
        runCmd(() => cmdContext([]));
      }
      runCmd(() => cmdContext(['--scope', 'Cortex']));
      const r = runCmd(() => cmdObserve());
      const hintsIdx = r.stdout.indexOf('[触发提示]');
      const healthIdx = r.stdout.indexOf('[使用健康信号]');
      if (hintsIdx !== -1 && healthIdx !== -1) {
        assert.ok(hintsIdx < healthIdx, 'trigger hints 应在 health signals 之前');
      }
    });
  });

  it('trigger hints 出现在 recap 之前', () => {
    withTmpHome(() => {
      for (let i = 0; i < HEALTH_LOW_SAMPLE_THRESHOLD - 1; i++) {
        runCmd(() => cmdContext([]));
      }
      runCmd(() => cmdContext(['--scope', 'Cortex']));
      const r = runCmd(() => cmdObserve());
      const hintsIdx = r.stdout.indexOf('[触发提示]');
      const recapIdx = r.stdout.indexOf('[使用摘要]');
      if (hintsIdx !== -1) {
        assert.ok(hintsIdx < recapIdx, 'trigger hints 应在 recap 之前');
      }
    });
  });

  it('四层输出（trigger hints + health signals + recap + records）可共存', () => {
    withTmpHome(() => {
      // inject 3 + context 3 = inject 50%, 让 inject_pattern_observed 触发
      runCmd(() => cmdInject([]));
      runCmd(() => cmdInject([]));
      runCmd(() => cmdInject([]));
      runCmd(() => cmdContext([]));
      runCmd(() => cmdContext([]));
      runCmd(() => cmdContext([]));
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);
      assert.ok(r.stdout.includes('[触发提示]'), `缺 trigger hints: stdout=${r.stdout}`);
      assert.ok(r.stdout.includes('[使用摘要]'), `缺 recap: stdout=${r.stdout}`);
      assert.ok(r.stdout.includes('[最近使用记录]'), `缺 records: stdout=${r.stdout}`);
    });
  });

  it('trigger hints 不含 user fact inference / 注入正文', () => {
    withTmpHome(() => {
      for (let i = 0; i < HEALTH_LOW_SAMPLE_THRESHOLD - 1; i++) {
        runCmd(() => cmdInject([]));
      }
      runCmd(() => cmdContext(['--scope', 'Cortex']));
      const r = runCmd(() => cmdObserve());
      assert.ok(!r.stdout.includes('--- Cortex'), `不应含注入正文: stdout=${r.stdout}`);
      assert.ok(!r.stdout.includes('建议你'), `不应含推断建议: stdout=${r.stdout}`);
    });
  });
});
