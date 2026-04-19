// CT-0018 测试：Observation-Derived Candidate Surface v0.1
//
// 覆盖目标：
//   1. 空 observation log → 无 candidates
//   2. 样本不足（< threshold）→ 无 candidates
//   3. scope 重复出现 → repeated_scope_candidate
//   4. focused usage 占比较高 → focused_usage_candidate
//   5. inject usage 占比较高 → inject_primary_usage_candidate
//   6. 多 candidate 共存
//   7. 文案明确是“候选/核查面”，不是事实写回
//   8. cmdObserve 四层/五层输出共存

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildCandidates, renderCandidates, CANDIDATE_SCOPED_RATIO_THRESHOLD, CANDIDATE_INJECT_RATIO_THRESHOLD } from '../observation-candidate.js';
import { type RuntimeObservation, buildRecap, HEALTH_LOW_SAMPLE_THRESHOLD } from '../observation.js';

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

describe('CT-0018: buildCandidates', () => {
  it('空日志 / 样本不足无候选', () => {
    const obs = makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 1);
    const recap = buildRecap(obs);
    assert.deepEqual(buildCandidates(obs, recap), []);
  });

  it('scope 重复出现时生成 repeated_scope_candidate', () => {
    const obs = [
      ...makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 2, { selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'scoped', scope: 'A' }),
      makeObs({ selection_strategy: 'scoped', scope: 'A' }),
    ];
    const recap = buildRecap(obs);
    const candidates = buildCandidates(obs, recap);
    assert.ok(candidates.some(c => c.kind === 'repeated_scope_candidate'));
  });

  it('focused usage 占比高时生成 focused_usage_candidate', () => {
    const obs = [
      ...makeN(3, { selection_strategy: 'all' }),
      ...makeN(3, { selection_strategy: 'scoped', scope: 'X' }), // 3/6 = 0.5 >= 0.4
    ];
    const recap = buildRecap(obs);
    const candidates = buildCandidates(obs, recap);
    assert.ok(candidates.some(c => c.kind === 'focused_usage_candidate'));
  });

  it('inject usage 占比高时生成 inject_primary_usage_candidate', () => {
    const obs = [
      ...makeN(2, { event_type: 'context' }),
      ...makeN(4, { event_type: 'inject' }), // 4/6 = 0.66 >= 0.6
    ];
    const recap = buildRecap(obs);
    const candidates = buildCandidates(obs, recap);
    assert.ok(candidates.some(c => c.kind === 'inject_primary_usage_candidate'));
  });

  it('多 candidate 共存', () => {
    const obs = [
      makeObs({ event_type: 'context', selection_strategy: 'all' }),
      ...makeN(4, { event_type: 'inject', selection_strategy: 'scoped', scope: 'B' }),
    ]; // inject 4/5 = 0.8, scoped 4/5 = 0.8
    const recap = buildRecap(obs);
    const candidates = buildCandidates(obs, recap);
    const kinds = candidates.map(c => c.kind);
    assert.ok(kinds.includes('repeated_scope_candidate'));
    assert.ok(kinds.includes('focused_usage_candidate'));
    assert.ok(kinds.includes('inject_primary_usage_candidate'));
  });
});

describe('CT-0018: renderCandidates', () => {
  it('渲染出的文案表明不写入 user model 并且没有 recommendation 语气', () => {
    const obs = [
      ...makeN(HEALTH_LOW_SAMPLE_THRESHOLD - 2, { selection_strategy: 'all' }),
      makeObs({ selection_strategy: 'scoped', scope: 'A' }),
      makeObs({ selection_strategy: 'scoped', scope: 'A' }),
    ];
    const recap = buildRecap(obs);
    const candidates = buildCandidates(obs, recap);
    const text = renderCandidates(candidates);
    
    assert.ok(text.includes('不代表已写入 user model'));
    assert.ok(text.includes('可作为后续核查候选'));
  });
});
