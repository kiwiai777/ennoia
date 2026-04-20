// CT-0021-03 测试：Candidate Generator
//
// 覆盖目标：
//   基础正确性（单条 / 多条 / 无匹配 / 空数组）
//   顺序稳定性（跨输入顺序 / 单输入内部顺序）
//   鲁棒性（空字符串 / 全空白 / 不 dedupe）
//   边界一致性（所有输出满足 createCandidate 结构约束）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCandidatesFromRecent } from '../generateCandidatesFromRecent.js';

describe('generateCandidatesFromRecent', () => {
  // ── 基础正确性 ────────────────────────────────────────────────────────────

  it('generates candidate from single input', () => {
    const result = generateCandidatesFromRecent(['我喜欢深色模式']);
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'preference');
  });

  it('flattens candidates from multiple inputs', () => {
    const result = generateCandidatesFromRecent([
      '我喜欢深色模式',
      '我的目标是本周完成',
    ]);
    assert.equal(result.length, 2);
    assert.equal(result[0].type, 'preference');
    assert.equal(result[1].type, 'goal');
  });

  it('returns empty array when no input matches', () => {
    const result = generateCandidatesFromRecent(['今天天气不错', '随便聊聊']);
    assert.deepEqual(result, []);
  });

  it('returns empty array for empty input list', () => {
    assert.deepEqual(generateCandidatesFromRecent([]), []);
  });

  // ── 顺序稳定性 ────────────────────────────────────────────────────────────

  it('preserves order across multiple recent inputs', () => {
    const result = generateCandidatesFromRecent([
      '我不想配置太复杂',
      '我的目标是下周上线',
      '我喜欢简洁的回答',
    ]);
    assert.equal(result.length, 3);
    assert.equal(result[0].type, 'constraint');
    assert.equal(result[1].type, 'goal');
    assert.equal(result[2].type, 'preference');
  });

  it('preserves intra-input sentence order for multi-sentence input', () => {
    const result = generateCandidatesFromRecent([
      '我喜欢深色模式。我的目标是完成项目。时间很紧。',
    ]);
    assert.equal(result.length, 3);
    assert.equal(result[0].type, 'preference');
    assert.equal(result[1].type, 'goal');
    assert.equal(result[2].type, 'constraint');
  });

  // ── 鲁棒性 ────────────────────────────────────────────────────────────────

  it('ignores empty strings without throwing', () => {
    assert.doesNotThrow(() => {
      const result = generateCandidatesFromRecent(['', '我喜欢深色模式', '']);
      assert.equal(result.length, 1);
    });
  });

  it('ignores whitespace-only strings without throwing', () => {
    assert.doesNotThrow(() => {
      const result = generateCandidatesFromRecent(['   ', '\t', '我的目标是完成任务']);
      assert.equal(result.length, 1);
    });
  });

  it('does not dedupe identical candidates from different inputs', () => {
    const result = generateCandidatesFromRecent([
      '我喜欢深色模式',
      '我喜欢深色模式',
    ]);
    assert.equal(result.length, 2);
  });

  // ── 边界一致性 ────────────────────────────────────────────────────────────

  it('all results satisfy SuggestCandidate schema constraints', () => {
    const result = generateCandidatesFromRecent([
      '我偏好用中文交流',
      '我计划下周发布',
      '我不想增加成本',
    ]);
    assert.equal(result.length, 3);
    for (const c of result) {
      assert.equal(c.source, 'recent_activity');
      assert.equal(c.confidence, 'low');
      assert.ok(['preference', 'goal', 'constraint'].includes(c.type));
      assert.ok(c.content.trim().length > 0);
    }
  });
});
