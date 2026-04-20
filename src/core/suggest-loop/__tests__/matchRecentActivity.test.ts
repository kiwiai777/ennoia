// CT-0021-02 测试：Recent Activity Pattern Matcher
//
// 覆盖目标：
//   基础正确性（preference / goal / constraint / 无匹配）
//   多句输入按顺序产出多个 candidate
//   保守性（问题句 / 假设句 / 引用句不误识别）
//   结构一致性（所有结果来自 createCandidate 约束）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchRecentActivity } from '../matchRecentActivity.js';

describe('matchRecentActivity', () => {
  // ── 基础正确性 ────────────────────────────────────────────────────────────

  it('recognizes preference sentence', () => {
    const result = matchRecentActivity('我喜欢深色模式');
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'preference');
    assert.equal(result[0].source, 'recent_activity');
    assert.equal(result[0].confidence, 'low');
    assert.ok(result[0].content.length > 0);
  });

  it('recognizes goal sentence', () => {
    const result = matchRecentActivity('我的目标是在十天内上线');
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'goal');
  });

  it('recognizes constraint sentence', () => {
    const result = matchRecentActivity('我不想配置太复杂');
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'constraint');
  });

  it('returns empty array when no pattern matches', () => {
    assert.deepEqual(matchRecentActivity('今天天气不错'), []);
    assert.deepEqual(matchRecentActivity(''), []);
  });

  // ── 多句输入 ──────────────────────────────────────────────────────────────

  it('returns multiple candidates in input order for multi-sentence input', () => {
    const result = matchRecentActivity('我喜欢深色模式。我的目标是完成项目。时间很紧。');
    assert.equal(result.length, 3);
    assert.equal(result[0].type, 'preference');
    assert.equal(result[1].type, 'goal');
    assert.equal(result[2].type, 'constraint');
  });

  it('handles newline-separated sentences', () => {
    const result = matchRecentActivity('我偏好用中文交流\n我正在推进 Cortex 项目');
    assert.equal(result.length, 2);
    assert.equal(result[0].type, 'preference');
    assert.equal(result[1].type, 'goal');
  });

  // ── 保守性 ────────────────────────────────────────────────────────────────

  it('does not match question sentences ending with ？', () => {
    assert.deepEqual(matchRecentActivity('我喜欢这个功能吗？'), []);
    assert.deepEqual(matchRecentActivity('是不是我不想用这个？'), []);
  });

  it('does not match hedged sentences', () => {
    assert.deepEqual(matchRecentActivity('也许我喜欢更简洁的方式'), []);
    assert.deepEqual(matchRecentActivity('或许我的目标是完成这件事'), []);
    assert.deepEqual(matchRecentActivity('如果时间很紧的话怎么办'), []);
  });

  it('does not match hypothetical sentences', () => {
    assert.deepEqual(matchRecentActivity('假设我们之后要加一个我喜欢的功能'), []);
  });

  it('does not match quoted or generic descriptions', () => {
    assert.deepEqual(matchRecentActivity('有人说我喜欢配置复杂的工具'), []);
    assert.deepEqual(matchRecentActivity('比如说我喜欢的方案是这个'), []);
  });

  // ── 结构一致性 ────────────────────────────────────────────────────────────

  it('all results satisfy SuggestCandidate schema constraints', () => {
    const result = matchRecentActivity('我偏爱简洁的回答。我计划下周完成。我不想增加成本。');
    assert.equal(result.length, 3);
    for (const c of result) {
      assert.equal(c.source, 'recent_activity');
      assert.equal(c.confidence, 'low');
      assert.ok(['preference', 'goal', 'constraint'].includes(c.type));
      assert.ok(c.content.trim().length > 0);
    }
  });

  it('content preserves the original sentence', () => {
    const sentence = '我喜欢深色模式';
    const result = matchRecentActivity(sentence);
    assert.equal(result[0].content, sentence);
  });
});
