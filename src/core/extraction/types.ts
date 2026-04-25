// Extraction 层共享类型
//
// CandidateItem 是 extractor 输出的"候选"——尚未进 user model，
// 需要用户在 CLI 里挑选后才会写入。每个候选必须携带来源路径，
// 以保证用户可以看到"这条来自哪个文件"，下游写入时也按来源标注 source。

import type { SourceDescriptor } from '../source/types.js';

export type CandidateType = 'goal' | 'constraint' | 'preference' | 'skill' | 'project';

export interface CandidateItem {
  // 可选分类：
  //   - basic extractor 无法可靠判断，留空（写入时默认落 goals）
  //   - llm extractor 会尝试填
  // 这里目前强转为 string 防止 WriteCategory 冲突，或者后续更新 WriteCategory 支持 skill/project
  type?: CandidateType | string;

  // 候选文本（已 trim / 归一）
  text: string;

  // 来源文件路径；由 adapter 提供，extractor 透传
  source_path: string;
}

// CT-0022-01: 通用 Extraction 层核心类型
export type ExtractionHint = 'agent-def' | 'skill-def' | 'readme' | 'package-manifest' | 'plain' | 'user-profile';

export interface ContentBlock {
  path: string;              // 相对路径或标识，用于 provenance
  content: string;           // 文本内容
  kind: 'markdown' | 'json' | 'yaml' | 'plain';
  hint?: ExtractionHint;     // hint 让 extractor 知道这块文本的语义上下文
}

export interface ExtractionInput {
  sourceId: string;          // 来源 adapter id，如 'claude-code'
  sourceDescriptor: SourceDescriptor;
  contentBlocks: ContentBlock[];
}

export interface ExtractionCandidate {
  kind: CandidateType;
  content: string;
  provenance: {
    source: string;          // 如 'claude-code'
    path: string;            // 文件相对路径
    snippet?: string;        // 原文片段（可选，用于调试）
  };
}