// CT-0021 — Suggest Loop v0: Candidate Schema
//
// Candidate 是从 recent activity 提取的"建议性用户事实"，
// 需经用户确认后才可写入 user model。

export type CandidateType = 'preference' | 'goal' | 'constraint';
export type CandidateSource = 'recent_activity';
export type CandidateConfidence = 'low';

export interface SuggestCandidate {
  type: CandidateType;
  content: string;
  source: CandidateSource;
  confidence: CandidateConfidence;
}

const VALID_TYPES = new Set<CandidateType>(['preference', 'goal', 'constraint']);

export function createCandidate(type: CandidateType, content: string): SuggestCandidate {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`Invalid candidate type: ${type}`);
  }
  if (!content.trim()) {
    throw new Error('Candidate content must not be empty');
  }
  return { type, content, source: 'recent_activity', confidence: 'low' };
}
