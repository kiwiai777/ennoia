import { ObservationRecap, RuntimeObservation, HEALTH_LOW_SAMPLE_THRESHOLD } from './observation.js';

// CT-0018: Observation-Derived Candidate Surface v0.1
// 纯观察性候选核查面：基于已被观察到反复出现的使用模式，向用户提供"可核查候选"，
// 不自动写回 user model，不作为 action recommendation。

export type CandidateKind =
  | 'scope_preference_candidate'
  | 'focused_usage_candidate'
  | 'inject_primary_usage_candidate';

export interface ObservationCandidate {
  kind: CandidateKind;
  message: string;
}

export const CANDIDATE_SCOPED_RATIO_THRESHOLD = 0.4;
export const CANDIDATE_INJECT_RATIO_THRESHOLD = 0.6;

export function buildCandidates(observations: RuntimeObservation[], recap: ObservationRecap): ObservationCandidate[] {
  const total = observations.length;
  if (total < HEALTH_LOW_SAMPLE_THRESHOLD) return [];

  const candidates: ObservationCandidate[] = [];

  // 如果某个 scope 反复出现
  if (recap.topScope && recap.scopedCount > 1) {
    candidates.push({
      kind: 'repeated_scope_candidate',
      message: `已观察到 scope '${recap.topScope}' 重复出现，可作为后续核查候选`,
    });
  }

  // 聚焦使用达到特定比例
  if (recap.scopedCount / total >= CANDIDATE_SCOPED_RATIO_THRESHOLD) {
    candidates.push({
      kind: 'focused_usage_candidate',
      message: `已观察到聚焦使用 (scoped) 占比较高，可作为后续核查候选`,
    });
  }

  // Inject 使用达到特定比例
  if (recap.injectCount / total >= CANDIDATE_INJECT_RATIO_THRESHOLD) {
    candidates.push({
      kind: 'inject_primary_usage_candidate',
      message: `已观察到以 inject 为主的使用模式，可作为后续核查候选`,
    });
  }

  return candidates;
}

export function renderCandidates(candidates: ObservationCandidate[]): string {
  if (candidates.length === 0) return '';
  const lines: string[] = ['[观察发现的稳定模式（供核查候选）]', ''];
  lines.push('  以下内容仅表示运行时使用模式，不代表已写入 user model：');
  for (const c of candidates) {
    lines.push(`  · ${c.message}`);
  }
  return lines.join('\n');
}
