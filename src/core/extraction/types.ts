// Extraction 层共享类型
//
// CandidateItem 是 extractor 输出的"候选"——尚未进 user model，
// 需要用户在 CLI 里挑选后才会写入。
//
// type 可选：
//   - basic extractor 不填（无法可靠判断类别）
//   - llm extractor 会填
// 写入时 type 缺失则默认落到 goals。

export type CandidateType = 'goal' | 'constraint' | 'preference';

export interface CandidateItem {
  type?: CandidateType;
  text: string;
}
