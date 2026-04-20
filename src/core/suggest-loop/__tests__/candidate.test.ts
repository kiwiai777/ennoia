// CT-0021 测试：Suggest Loop Candidate Schema
//
// 覆盖目标：
//   1. createCandidate 返回结构符合 schema
//   2. source 固定为 recent_activity
//   3. confidence 固定为 low
//   4. 三种合法 type 均可创建
//   5. type 非法时抛错
//   6. content 为空时抛错
//   7. 可 JSON 序列化

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCandidate, type SuggestCandidate, type CandidateType } from '../candidate.js';

describe('createCandidate', () => {
  it('returns correct schema for preference', () => {
    const c = createCandidate('preference', 'I prefer dark mode');
    assert.deepEqual(c, {
      type: 'preference',
      content: 'I prefer dark mode',
      source: 'recent_activity',
      confidence: 'low',
    });
  });

  it('returns correct schema for goal', () => {
    const c = createCandidate('goal', 'ship v1 by end of month');
    assert.equal(c.type, 'goal');
    assert.equal(c.source, 'recent_activity');
    assert.equal(c.confidence, 'low');
  });

  it('returns correct schema for constraint', () => {
    const c = createCandidate('constraint', 'no breaking changes');
    assert.equal(c.type, 'constraint');
    assert.equal(c.source, 'recent_activity');
    assert.equal(c.confidence, 'low');
  });

  it('is JSON serializable', () => {
    const c = createCandidate('goal', 'test json');
    const json = JSON.stringify(c);
    const parsed = JSON.parse(json) as SuggestCandidate;
    assert.deepEqual(parsed, c);
  });

  it('throws on invalid type', () => {
    assert.throws(
      () => createCandidate('unknown' as CandidateType, 'content'),
      /Invalid candidate type/,
    );
  });

  it('throws on empty content', () => {
    assert.throws(() => createCandidate('goal', ''), /must not be empty/);
    assert.throws(() => createCandidate('goal', '   '), /must not be empty/);
  });
});
