// Extraction 层共享类型
//
// CandidateItem 是 extractor 输出的"候选"——尚未进 user model，
// 需要用户在 CLI 里挑选后才会写入。每个候选必须携带来源路径，
// 以保证用户可以看到"这条来自哪个文件"，下游写入时也按来源标注 source。

export type CandidateType = 'goal' | 'constraint' | 'preference';

export interface CandidateItem {
  // 可选分类：
  //   - basic extractor 无法可靠判断，留空（写入时默认落 goals）
  //   - llm extractor 会尝试填
  type?: CandidateType;

  // 候选文本（已 trim / 归一）
  text: string;

  // 来源文件路径；由 adapter 提供，extractor 透传
  source_path: string;
}
