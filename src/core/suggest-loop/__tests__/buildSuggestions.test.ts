// CT-0021-04 测试：Candidate → SuggestionItem compiler
//
// 覆盖目标：
//   基础正确性（三类 type / 空数组）
//   顺序稳定
//   displayText 模板正确性
//   id 稳定性与可区分性
//   边界一致性（不 dedupe / 无多余字段）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSuggestions, type SuggestionItem } from '../buildSuggestions.js';
import { createCandidate } from '../candidate.js';

const pref = createCandidate('preference', '我喜欢深色模式');
const goal = createCandidate('goal', '我的目标是本周上线');
const constraint = createCandidate('constraint', '我不想配置太复杂');

describe('buildSuggestions', () => {
  // ── 基础正确性 ────────────────────────────────────────────────────────────

  it('builds correct item for preference candidate', () => {
    const [item] = buildSuggestions([pref]);
    assert.equal(item.type, 'preference');
    assert.equal(item.content, pref.content);
    assert.ok(item.id.length > 0);
    assert.ok(item.displayText.length > 0);
  });

  it('builds correct item for goal candidate', () => {
    const [item] = buildSuggestions([goal]);
    assert.equal(item.type, 'goal');
    assert.equal(item.content, goal.content);
  });

  it('builds correct item for constraint candidate', () => {
    const [item] = buildSuggestions([constraint]);
    assert.equal(item.type, 'constraint');
    assert.equal(item.content, constraint.content);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(buildSuggestions([]), []);
  });

  // ── 顺序稳定 ──────────────────────────────────────────────────────────────

  it('preserves input order', () => {
    const result = buildSuggestions([pref, goal, constraint]);
    assert.equal(result[0].type, 'preference');
    assert.equal(result[1].type, 'goal');
    assert.equal(result[2].type, 'constraint');
  });

  // ── displayText 正确性 ────────────────────────────────────────────────────

  it('displayText uses correct prefix for each type', () => {
    const [p] = buildSuggestions([pref]);
    const [g] = buildSuggestions([goal]);
    const [c] = buildSuggestions([constraint]);
    assert.ok(p.displayText.startsWith('Add this as a preference:'));
    assert.ok(g.displayText.startsWith('Add this as a goal:'));
    assert.ok(c.displayText.startsWith('Add this as a constraint:'));
  });

  it('displayText contains original content', () => {
    const [item] = buildSuggestions([pref]);
    assert.ok(item.displayText.includes(pref.content));
  });

  // ── id 稳定性 ─────────────────────────────────────────────────────────────

  it('produces stable id across repeated calls with same input', () => {
    const id1 = buildSuggestions([pref])[0].id;
    const id2 = buildSuggestions([pref])[0].id;
    assert.equal(id1, id2);
  });

  it('produces distinct ids for candidates at different positions', () => {
    const result = buildSuggestions([pref, pref]);
    assert.notEqual(result[0].id, result[1].id);
  });

  it('produces distinct ids for candidates with different content', () => {
    const a = createCandidate('preference', '我喜欢深色模式');
    const b = createCandidate('preference', '我喜欢简洁回答');
    const [ia, ib] = buildSuggestions([a, b]);
    assert.notEqual(ia.id, ib.id);
  });

  // ── 边界一致性 ────────────────────────────────────────────────────────────

  it('does not dedupe identical candidates', () => {
    const result = buildSuggestions([pref, pref]);
    assert.equal(result.length, 2);
  });

  it('output object has exactly the four expected keys', () => {
    const [item] = buildSuggestions([pref]);
    const keys = Object.keys(item).sort();
    assert.deepEqual(keys, ['content', 'displayText', 'id', 'type']);
  });
});
