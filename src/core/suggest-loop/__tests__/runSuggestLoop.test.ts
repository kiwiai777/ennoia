// CT-0021-06 测试：Suggest Loop pipeline
//
// 覆盖目标：
//   基础闭环（confirm 写入 / skip 不写入）
//   多 suggestion 混合行为
//   actions 对齐规则（少于 / 多于 suggestions）
//   空输入
//   结果透明性与边界一致性

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSuggestLoop } from '../runSuggestLoop.js';

describe('runSuggestLoop', () => {
  // ── 基础闭环 ──────────────────────────────────────────────────────────────

  it('confirm writes entry to store', () => {
    const result = runSuggestLoop({
      recent: ['我喜欢深色模式'],
      actions: ['confirm'],
    });
    assert.equal(result.store.entries.length, 1);
    assert.equal(result.store.entries[0].type, 'preference');
  });

  it('skip does not write entry to store', () => {
    const result = runSuggestLoop({
      recent: ['我喜欢深色模式'],
      actions: ['skip'],
    });
    assert.equal(result.store.entries.length, 0);
  });

  // ── 多 suggestion 混合行为 ────────────────────────────────────────────────

  it('mixed actions produce correct store', () => {
    const result = runSuggestLoop({
      recent: ['我喜欢深色模式', '我的目标是本周上线', '我不想配置太复杂'],
      actions: ['confirm', 'skip', 'confirm'],
    });
    assert.equal(result.store.entries.length, 2);
    assert.equal(result.store.entries[0].type, 'preference');
    assert.equal(result.store.entries[1].type, 'constraint');
  });

  it('confirm order matches suggestion order', () => {
    const result = runSuggestLoop({
      recent: ['我的目标是完成项目', '我喜欢简洁回答'],
      actions: ['confirm', 'confirm'],
    });
    assert.equal(result.store.entries[0].type, 'goal');
    assert.equal(result.store.entries[1].type, 'preference');
  });

  // ── actions 对齐规则 ──────────────────────────────────────────────────────

  it('missing actions default to skip', () => {
    const result = runSuggestLoop({
      recent: ['我喜欢深色模式', '我的目标是本周上线'],
      actions: ['confirm'],
    });
    assert.equal(result.store.entries.length, 1);
    assert.equal(result.store.entries[0].type, 'preference');
  });

  it('extra actions are ignored without error', () => {
    assert.doesNotThrow(() => {
      const result = runSuggestLoop({
        recent: ['我喜欢深色模式'],
        actions: ['confirm', 'confirm', 'confirm'],
      });
      assert.equal(result.store.entries.length, 1);
    });
  });

  // ── 空输入 ────────────────────────────────────────────────────────────────

  it('empty recent returns empty suggestions and empty store', () => {
    const result = runSuggestLoop({ recent: [], actions: [] });
    assert.equal(result.suggestions.length, 0);
    assert.equal(result.store.entries.length, 0);
  });

  it('unmatched recent returns empty suggestions and empty store', () => {
    const result = runSuggestLoop({
      recent: ['今天天气不错', '随便聊聊'],
      actions: ['confirm'],
    });
    assert.equal(result.suggestions.length, 0);
    assert.equal(result.store.entries.length, 0);
  });

  // ── 透明性 ────────────────────────────────────────────────────────────────

  it('result contains full suggestions list', () => {
    const result = runSuggestLoop({
      recent: ['我喜欢深色模式', '我的目标是本周上线'],
      actions: ['skip', 'skip'],
    });
    assert.equal(result.suggestions.length, 2);
  });

  it('store entries have correct type/content/source', () => {
    const result = runSuggestLoop({
      recent: ['我偏好用中文交流'],
      actions: ['confirm'],
    });
    const entry = result.store.entries[0];
    assert.equal(entry.source, 'suggest_loop');
    assert.ok(['preference', 'goal', 'constraint'].includes(entry.type));
    assert.ok(entry.content.trim().length > 0);
  });

  // ── 边界一致性 ────────────────────────────────────────────────────────────

  it('pipeline does not dedupe identical suggestions', () => {
    const result = runSuggestLoop({
      recent: ['我喜欢深色模式', '我喜欢深色模式'],
      actions: ['confirm', 'confirm'],
    });
    assert.equal(result.store.entries.length, 2);
  });

  it('result has exactly suggestions and store keys', () => {
    const result = runSuggestLoop({ recent: [], actions: [] });
    assert.deepEqual(Object.keys(result).sort(), ['store', 'suggestions']);
  });
});
