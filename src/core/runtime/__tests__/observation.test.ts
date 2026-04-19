// CT-0014 测试：Runtime Observation Foundation v0.1
//
// 覆盖目标：
//   1. appendObservation 正常写入并可被 loadObservationLog 读回
//   2. inject 成功后产生 observation（via cmdInject in-process）
//   3. context 成功后产生 observation（via cmdContext in-process）
//   4. 失败路径（process.exit 前）不写 observation
//   5. observe 命令可读出最近记录
//   6. observation 不含具体内容字段（no entries content / injection text）
//   7. observation 与 user model 存储隔离（不同文件）
//   8. 滚动截断：超过 MAX 时截断最旧记录
//   9. 空记录时 observe 输出稳定

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendObservation,
  loadObservationLog,
  renderObservation,
  getObservationsPath,
  type RuntimeObservation,
} from '../observation.js';
import { cmdInject, cmdContext, cmdObserve } from '../../../index.js';

// ── helpers ──────────────────────────────────────────────────────────────────

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

function withTmpHome<T>(fn: (tmpHome: string) => T): T {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-obstest-'));
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

  process.exit = (code?: number): never => {
    status = code ?? 0;
    throw new ProcessExitError(code ?? 0);
  };
  console.log = (...a: unknown[]) => { stdout += a.map(String).join(' ') + '\n'; };
  console.error = (...a: unknown[]) => { stderr += a.map(String).join(' ') + '\n'; };

  try {
    fn();
  } catch (e) {
    if (!(e instanceof ProcessExitError)) throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origError;
  }

  return { status, stdout, stderr };
}

// ── observation 模块单元测试 ──────────────────────────────────────────────────

describe('CT-0014: appendObservation / loadObservationLog', () => {
  it('空环境下 loadObservationLog 返回空日志', () => {
    withTmpHome(() => {
      const log = loadObservationLog();
      assert.equal(log.version, '0.1');
      assert.deepEqual(log.observations, []);
    });
  });

  it('appendObservation 写入后可被 loadObservationLog 读回', () => {
    withTmpHome(() => {
      appendObservation({
        event_type: 'context',
        selection_strategy: 'all',
        selected_entries: 5,
        total_entries: 5,
      });
      const log = loadObservationLog();
      assert.equal(log.observations.length, 1);
      const obs = log.observations[0];
      assert.equal(obs.event_type, 'context');
      assert.equal(obs.selection_strategy, 'all');
      assert.equal(obs.selected_entries, 5);
      assert.equal(obs.total_entries, 5);
      assert.equal(typeof obs.id, 'string');
      assert.equal(typeof obs.timestamp, 'string');
    });
  });

  it('inject 类型 observation 包含 agent 字段', () => {
    withTmpHome(() => {
      appendObservation({
        event_type: 'inject',
        agent: 'claude-code',
        scope: 'Cortex',
        task_hint: 'injection',
        selection_strategy: 'scoped',
        selected_entries: 3,
        total_entries: 8,
      });
      const log = loadObservationLog();
      const obs = log.observations[0];
      assert.equal(obs.event_type, 'inject');
      assert.equal(obs.agent, 'claude-code');
      assert.equal(obs.scope, 'Cortex');
      assert.equal(obs.task_hint, 'injection');
      assert.equal(obs.selection_strategy, 'scoped');
    });
  });

  it('observation 不含具体内容字段（无 entries 文本、无注入正文）', () => {
    withTmpHome(() => {
      appendObservation({
        event_type: 'inject',
        agent: 'generic',
        selection_strategy: 'all',
        selected_entries: 4,
        total_entries: 4,
      });
      const log = loadObservationLog();
      const obs = log.observations[0] as unknown as Record<string, unknown>;
      // 必须不含以下字段
      assert.ok(!('entries' in obs), 'observation 不应含 entries 字段');
      assert.ok(!('instruction_text' in obs), 'observation 不应含 instruction_text 字段');
      assert.ok(!('user_snapshot' in obs), 'observation 不应含 user_snapshot 字段');
      assert.ok(!('injection_text' in obs), 'observation 不应含 injection_text 字段');
    });
  });

  it('多次 append 后所有记录都保留', () => {
    withTmpHome(() => {
      appendObservation({ event_type: 'context', selection_strategy: 'all', selected_entries: 1, total_entries: 1 });
      appendObservation({ event_type: 'inject', agent: 'generic', selection_strategy: 'all', selected_entries: 2, total_entries: 2 });
      const log = loadObservationLog();
      assert.equal(log.observations.length, 2);
      assert.equal(log.observations[0].event_type, 'context');
      assert.equal(log.observations[1].event_type, 'inject');
    });
  });

  it('observation 存储路径与 user model 路径不同', () => {
    const obsPath = getObservationsPath();
    assert.ok(obsPath.includes('observations.json'), 'observation 路径应含 observations.json');
    assert.ok(!obsPath.includes('user_model.json'), 'observation 路径不应是 user_model.json');
  });

  it('损坏的 observations.json 返回空日志（不抛出）', () => {
    withTmpHome((tmpHome) => {
      const cortexDir = path.join(tmpHome, '.cortex');
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(path.join(cortexDir, 'observations.json'), '{broken json', 'utf-8');
      const log = loadObservationLog();
      assert.deepEqual(log.observations, []);
    });
  });
});

describe('CT-0014: renderObservation', () => {
  it('all 模式包含 全量 标签', () => {
    const obs: RuntimeObservation = {
      id: 'test-id',
      timestamp: '2026-04-19T10:00:00.000Z',
      event_type: 'context',
      selection_strategy: 'all',
      selected_entries: 5,
      total_entries: 5,
    };
    const line = renderObservation(obs);
    assert.ok(line.includes('context'), `line=${line}`);
    assert.ok(line.includes('全量'), `line=${line}`);
    assert.ok(line.includes('5/5'), `line=${line}`);
  });

  it('scoped 模式包含 聚焦 标签和 scope / task-hint', () => {
    const obs: RuntimeObservation = {
      id: 'test-id',
      timestamp: '2026-04-19T10:00:00.000Z',
      event_type: 'inject',
      agent: 'claude-code',
      scope: 'Cortex',
      task_hint: 'injection',
      selection_strategy: 'scoped',
      selected_entries: 3,
      total_entries: 8,
    };
    const line = renderObservation(obs);
    assert.ok(line.includes('inject'), `line=${line}`);
    assert.ok(line.includes('聚焦'), `line=${line}`);
    assert.ok(line.includes('Cortex'), `line=${line}`);
    assert.ok(line.includes('injection'), `line=${line}`);
    assert.ok(line.includes('3/8'), `line=${line}`);
  });
});

// ── CLI 集成测试（in-process）─────────────────────────────────────────────────

describe('CT-0014: cmdInject 写入 observation', () => {
  it('inject 成功后产生 observation', () => {
    withTmpHome(() => {
      const r = runCmd(() => cmdInject(['--format', 'json']));
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
      const log = loadObservationLog();
      assert.equal(log.observations.length, 1);
      assert.equal(log.observations[0].event_type, 'inject');
    });
  });

  it('inject --agent claude-code 产生 agent=claude-code 的 observation', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject(['--agent', 'claude-code']));
      const log = loadObservationLog();
      assert.equal(log.observations.length, 1);
      assert.equal(log.observations[0].agent, 'claude-code');
    });
  });

  it('inject --scope 产生 scoped observation', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject(['--scope', 'Cortex']));
      const log = loadObservationLog();
      assert.equal(log.observations.length, 1);
      assert.equal(log.observations[0].selection_strategy, 'scoped');
      assert.equal(log.observations[0].scope, 'Cortex');
    });
  });

  it('inject 失败路径（--format yaml）不写 observation', () => {
    withTmpHome(() => {
      const r = runCmd(() => cmdInject(['--format', 'yaml']));
      assert.notEqual(r.status, 0);
      const log = loadObservationLog();
      assert.equal(log.observations.length, 0, '失败路径不应写 observation');
    });
  });
});

describe('CT-0014: cmdContext 写入 observation', () => {
  it('context 成功后产生 observation', () => {
    withTmpHome(() => {
      const r = runCmd(() => cmdContext([]));
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
      const log = loadObservationLog();
      assert.equal(log.observations.length, 1);
      assert.equal(log.observations[0].event_type, 'context');
    });
  });

  it('context --scope 产生 scoped observation', () => {
    withTmpHome(() => {
      runCmd(() => cmdContext(['--scope', 'Cortex']));
      const log = loadObservationLog();
      assert.equal(log.observations.length, 1);
      assert.equal(log.observations[0].selection_strategy, 'scoped');
      assert.equal(log.observations[0].scope, 'Cortex');
    });
  });

  it('context 失败路径（缺参）不写 observation', () => {
    withTmpHome(() => {
      const r = runCmd(() => cmdContext(['--scope']));
      assert.notEqual(r.status, 0);
      const log = loadObservationLog();
      assert.equal(log.observations.length, 0, '失败路径不应写 observation');
    });
  });
});

describe('CT-0014: cmdObserve', () => {
  it('无记录时输出稳定（不崩溃）', () => {
    withTmpHome(() => {
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
      assert.ok(r.stdout.includes('暂无使用记录'), `stdout=${r.stdout}`);
    });
  });

  it('有记录时显示 [最近使用记录] 和条目', () => {
    withTmpHome(() => {
      runCmd(() => cmdInject([]));
      runCmd(() => cmdContext([]));
      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
      assert.ok(r.stdout.includes('[最近使用记录]'), `stdout=${r.stdout}`);
      assert.ok(r.stdout.includes('inject') || r.stdout.includes('context'), `stdout=${r.stdout}`);
    });
  });

  it('observe 输出不含具体 user model 内容', () => {
    withTmpHome(() => {
      // inject 会把 instruction_text 输出到 stdout；observe 不应重复它
      runCmd(() => cmdInject([]));
      const r = runCmd(() => cmdObserve());
      // observe 的 stdout 是纯元信息行，不含"--- Cortex 长期用户模型 ---"这类注入正文
      assert.ok(!r.stdout.includes('--- Cortex'), `observe 不应含注入正文: stdout=${r.stdout}`);
    });
  });
});
