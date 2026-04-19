import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates, renderCandidates } from '../observation-candidate.js';
import { buildRecap, type RuntimeObservation } from '../observation.js';

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

describe('CT-0018: 越界语义负向防回归校验', () => {
  it('渲染输出中不能包含 recommendation 越界词汇', () => {
    // 制造一个能触发全部候选的日志
    const obs = [
      makeObs({ event_type: 'context', selection_strategy: 'all' }),
      ...makeN(6, { event_type: 'inject', selection_strategy: 'scoped', scope: 'Y' }),
    ];
    const recap = buildRecap(obs);
    const candidates = buildCandidates(obs, recap);
    const text = renderCandidates(candidates);
    
    // 必须有输出才能断言
    assert.ok(text.length > 0);
    
    // 负向校验核心列表
    const forbidden = [
      '建议写入',
      '应更新',
      '自动采纳',
      '偏好已确认',
      '建议你',
      '应该',
      '系统判断',
      '自动用于行为',
    ];
    
    for (const word of forbidden) {
      assert.ok(!text.includes(word), `越界：输出了 "${word}"\n全文: ${text}`);
    }
  });
});
