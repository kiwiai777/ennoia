// CT-0021-05 测试：confirm / skip append-only write
//
// 覆盖目标：
//   基础正确性（三类 type confirm）
//   skip 语义（不写入 / 不改变 store）
//   append-only 语义（顺序 / 不 dedupe）
//   写入映射正确性（只写 type/content/source，source 固定）
//   store 行为（空 store / 纯函数不可变性）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { confirmSuggestion, emptyStore, type UserModelStore } from '../confirmSuggestion.js';
import { buildSuggestions } from '../buildSuggestions.js';
import { createCandidate } from '../candidate.js';

const prefItem = buildSuggestions([createCandidate('preference', '我喜欢深色模式')])[0];
const goalItem = buildSuggestions([createCandidate('goal', '我的目标是本周上线')])[0];
const constraintItem = buildSuggestions([createCandidate('constraint', '我不想配置太复杂')])[0];

describe('confirmSuggestion', () => {
  // ── 基础正确性 ────────────────────────────────────────────────────────────

  it('confirm preference appends a preference entry', () => {
    const result = confirmSuggestion(emptyStore(), prefItem, 'confirm');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].type, 'preference');
  });

  it('confirm goal appends a goal entry', () => {
    const result = confirmSuggestion(emptyStore(), goalItem, 'confirm');
    assert.equal(result.entries[0].type, 'goal');
  });

  it('confirm constraint appends a constraint entry', () => {
    const result = confirmSuggestion(emptyStore(), constraintItem, 'confirm');
    assert.equal(result.entries[0].type, 'constraint');
  });

  // ── skip 语义 ─────────────────────────────────────────────────────────────

  it('skip does not write any entry', () => {
    const result = confirmSuggestion(emptyStore(), prefItem, 'skip');
    assert.equal(result.entries.length, 0);
  });

  it('skip does not mutate existing entries', () => {
    const store = confirmSuggestion(emptyStore(), goalItem, 'confirm');
    const after = confirmSuggestion(store, prefItem, 'skip');
    assert.equal(after.entries.length, 1);
    assert.equal(after.entries[0].type, 'goal');
  });

  // ── append-only 语义 ──────────────────────────────────────────────────────

  it('two sequential confirms produce two entries', () => {
    const s1 = confirmSuggestion(emptyStore(), prefItem, 'confirm');
    const s2 = confirmSuggestion(s1, goalItem, 'confirm');
    assert.equal(s2.entries.length, 2);
  });

  it('confirming the same suggestion twice keeps both entries (no dedupe)', () => {
    const s1 = confirmSuggestion(emptyStore(), prefItem, 'confirm');
    const s2 = confirmSuggestion(s1, prefItem, 'confirm');
    assert.equal(s2.entries.length, 2);
  });

  it('entries preserve confirm order', () => {
    const s1 = confirmSuggestion(emptyStore(), prefItem, 'confirm');
    const s2 = confirmSuggestion(s1, goalItem, 'confirm');
    const s3 = confirmSuggestion(s2, constraintItem, 'confirm');
    assert.equal(s3.entries[0].type, 'preference');
    assert.equal(s3.entries[1].type, 'goal');
    assert.equal(s3.entries[2].type, 'constraint');
  });

  // ── 写入映射正确性 ────────────────────────────────────────────────────────

  it('entry contains only type, content, source', () => {
    const result = confirmSuggestion(emptyStore(), prefItem, 'confirm');
    const keys = Object.keys(result.entries[0]).sort();
    assert.deepEqual(keys, ['content', 'source', 'type']);
  });

  it('source is fixed as suggest_loop', () => {
    const result = confirmSuggestion(emptyStore(), prefItem, 'confirm');
    assert.equal(result.entries[0].source, 'suggest_loop');
  });

  it('content matches suggestion.content (not displayText)', () => {
    const result = confirmSuggestion(emptyStore(), prefItem, 'confirm');
    assert.equal(result.entries[0].content, prefItem.content);
    assert.notEqual(result.entries[0].content, prefItem.displayText);
  });

  it('suggestion id is not written to entry', () => {
    const result = confirmSuggestion(emptyStore(), prefItem, 'confirm');
    assert.ok(!('id' in result.entries[0]));
  });

  // ── store 行为 ────────────────────────────────────────────────────────────

  it('works with empty store', () => {
    assert.doesNotThrow(() => confirmSuggestion(emptyStore(), prefItem, 'confirm'));
  });

  it('does not mutate the original store object (pure function)', () => {
    const original: UserModelStore = { entries: [] };
    confirmSuggestion(original, prefItem, 'confirm');
    assert.equal(original.entries.length, 0);
  });
});
