// CT-0020 修复：Observe 面板收敛目标验证测试
// 验证 observe 面板已经完成层数收敛：
// 1. 不再出现 candidates 块和相关特定文案
// 2. 层级顺序固定为：[触发提示] -> [使用健康信号] -> [使用摘要] -> [最近使用记录]
// 3. 对含有 inject/scoped/task_hint 的复合样本，不会在不同块里反复生成同样语气的候选建议

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
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-observe-consolidation-'));
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

describe('CT-0020: cmdObserve 收敛目标验证', () => {
  it('验证复合样本下的层级收敛与去重', () => {
    withTmpHome(() => {
      // 构造包含多种信号的复合样本
      // 为了触发 Trigger hints (inject > 0.5, scoped > 0.3, has_task_hint)
      // 我们生成 4 个 inject, 2 个 scoped context (含 task-hint), 2 个 all context

      // Inject (4)
      for (let i = 0; i < 4; i++) {
        runCmd(() => cmdInject(['--agent', 'claude-code']));
      }
      
      // Scoped + TaskHint (2)
      for (let i = 0; i < 2; i++) {
        runCmd(() => cmdContext(['--scope', 'X', '--task-hint', 'T']));
      }

      // All Context (2)
      for (let i = 0; i < 2; i++) {
        runCmd(() => cmdContext([]));
      }

      const r = runCmd(() => cmdObserve());
      assert.equal(r.status, 0);

      const out = r.stdout;

      // 1. 验证 Candidate 块完全消失及相关旧文案不再出现
      assert.ok(!out.includes('[观察发现的稳定模式'), '不应出现 Candidate 块');
      assert.ok(!out.includes('供核查候选'), '不应出现 Candidate 旧文案');
      assert.ok(!out.includes('不代表已写入 user model'), '不应出现 Candidate 免责声明');
      assert.ok(!out.includes('可作为后续核查候选'), '不应出现 Candidate 特征句型');

      // 2. 验证正确的层级顺序
      const idxHints = out.indexOf('[触发提示]');
      const idxSignals = out.indexOf('[使用健康信号]');
      const idxRecap = out.indexOf('[使用摘要]');
      const idxRecords = out.indexOf('[最近使用记录]');

      assert.ok(idxHints !== -1, '应输出触发提示');
      assert.ok(idxSignals !== -1, '应输出健康信号');
      assert.ok(idxRecap !== -1, '应输出使用摘要');
      assert.ok(idxRecords !== -1, '应输出使用记录');

      assert.ok(idxHints < idxSignals, '层级顺序错误: hints 应在 signals 之前');
      assert.ok(idxSignals < idxRecap, '层级顺序错误: signals 应在 recap 之前');
      assert.ok(idxRecap < idxRecords, '层级顺序错误: recap 应在 records 之前');

      // 3. 轻量语义重叠验证
      // - Trigger hints 里会说 "已观察到 scoped 或 task-hint 使用" 等
      // - 确保没有其它层级重复用这种语气的句式描述同样事实
      const countObserved = (out.match(/已观察到/g) || []).length;
      // Trigger hints 可能会有 2~3 条包含 "已观察到"，但除了 Trigger hints 外的块里，
      // health signals 有 "已观察到聚焦使用" (因为 scopedCount > 0)。
      // 此处主要防止 candidate 层再提供重复表达，如果 countObserved 被显著拉高则可能有回流风险。
      // 目前预计 trigger hints 中最多有 3 条，health signals 中有 1 条
      assert.ok(countObserved <= 4, `不应存在过多的事实重叠输出 (当前 countObserved=${countObserved})`);

      // 防止 recommendation 文案混入
      assert.ok(!out.includes('建议'), '禁止建议文案');
      assert.ok(!out.includes('应该'), '禁止应该文案');
      assert.ok(!out.includes('可尝试'), '禁止尝试文案');
    });
  });
});
