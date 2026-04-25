// CT-0021-06 测试：Suggest Loop pipeline
//
// 覆盖目标：
//   多 suggestion 混合行为
//   空输入
//   结果透明性与边界一致性
// (Store tests removed in CT-0025-01 as reflect now writes to user_model.json)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSuggestLoop } from '../runSuggestLoop.js';

describe('runSuggestLoop', () => {

  // ── 空输入 ────────────────────────────────────────────────────────────────

  it('empty recent returns empty suggestions', () => {
    const result = runSuggestLoop({ recent: [] });
    assert.equal(result.suggestions.length, 0);
  });

  it('unmatched recent returns empty suggestions', () => {
    const result = runSuggestLoop({
      recent: ['今天天气不错', '随便聊聊'],
    });
    assert.equal(result.suggestions.length, 0);
  });

  // ── 透明性 ────────────────────────────────────────────────────────────────

  it('result contains full suggestions list', () => {
    const result = runSuggestLoop({
      recent: ['我喜欢深色模式', '我的目标是本周上线'],
    });
    assert.equal(result.suggestions.length, 2);
  });

  // ── 边界一致性 ────────────────────────────────────────────────────────────

  it('result has exactly suggestions key', () => {
    const result = runSuggestLoop({ recent: [] });
    assert.deepEqual(Object.keys(result).sort(), ['suggestions']);
  });
});
