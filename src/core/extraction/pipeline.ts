// Extraction Pipeline (CT-0027-04)
// 三层��调：Deterministic ��� LLM → Embedding Dedupe

import type { ContentBlock, ExtractionCandidate } from './types.js';
import type { LLMBackend, EmbeddingBackend } from '../../backends/types.js';
import type { CortexConfig } from '../../backends/config.js';

export interface PipelineOptions {
  llmBackend?: LLMBackend;
  embeddingBackend?: EmbeddingBackend;
  config: CortexConfig;
}

interface CandidateWithSource extends ExtractionCandidate {
  _source: 'deterministic' | 'llm';
  _embedding?: number[];
}

/**
 * 计算��弦相��度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * 从 path 提取 adapter id
 */
function extractAdapterFromPath(path: string): string {
  // path 格式��� "chatgpt-export:conversations.json/conv-123"
  const match = path.match(/^([^:]+):/);
  return match ? match[1] : 'unknown';
}

/**
 * Layer 1: Deterministic extraction
 * 使用现��的 basic extractor 逻��
 */
async function runDeterministic(blocks: ContentBlock[]): Promise<CandidateWithSource[]> {
  // ��化版 deterministic：按关��词匹���
  const candidates: CandidateWithSource[] = [];

  const keywords = [
    '我想', '我��望', '我需���', '��喜欢', '我���喜欢', '我倾向',
    '避免', '不���', '禁止', '必���', '应该', '最好',
    'I want', 'I need', 'I prefer', 'I like', 'I dislike',
    'avoid', 'don\'t', 'must', 'should',
  ];

  for (const block of blocks) {
    const lines = block.content.split(/\n+/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 10 || trimmed.length > 200) continue;

      // 检查是��包含关键��
      const hasKeyword = keywords.some(kw =>
        trimmed.toLowerCase().includes(kw.toLowerCase())
      );

      if (hasKeyword) {
        // 简单分类
        let kind: 'preference' | 'goal' | 'constraint' = 'preference';
        if (trimmed.match(/我想|我希望|I want|goal/i)) {
          kind = 'goal';
        } else if (trimmed.match(/避���|不要|���止|avoid|don't|must not/i)) {
          kind = 'constraint';
        }

        candidates.push({
          kind,
          content: trimmed,
          provenance: {
            source: `cli:sync:deterministic:${block.path}`,
            path: block.path,
          },
          _source: 'deterministic',
        });
      }
    }
  }

  return candidates;
}

/**
 * Layer 2: LLM extraction
 */
async function runLLMExtraction(
  blocks: ContentBlock[],
  backend: LLMBackend
): Promise<CandidateWithSource[]> {
  const candidates: CandidateWithSource[] = [];
  let processed = 0;

  for (const block of blocks) {
    try {
      // 进度提示（�� 10 个或最��一个）
      if (processed % 10 === 0 || processed === blocks.length - 1) {
        console.error(`  LLM extraction: ${processed + 1}/${blocks.length}...`);
      }

      // 调用 LLM backend
      const llmResults = await backend.extract({
        content: block.content,
        hint: block.hint,
      });

      // 转 ExtractionCandidate��含 provenance）
      for (const result of llmResults) {
        candidates.push({
          kind: result.kind,
          content: result.content,
          provenance: {
            source: `cli:sync:llm:${block.path}`,
            path: block.path,
          },
          _source: 'llm',
        });
      }

      processed++;
    } catch (err) {
      // LLM 单次���用失败不��塞整体��—继续��一个
      console.error(`  ��️  LLM extraction failed for block ${block.path}: ${(err as Error).message}`);
      processed++;
    }
  }

  console.error(`�� LLM extraction: ${blocks.length} blocks → ${candidates.length} candidates`);
  return candidates;
}

/**
 * Layer 3: Batch dedupe（��次提取内��去重���
 */
async function batchDedupe(
  candidates: CandidateWithSource[],
  embeddingBackend: EmbeddingBackend,
  threshold: number
): Promise<CandidateWithSource[]> {
  if (candidates.length === 0) {
    return [];
  }

  console.error(`  Batch dedupe: ${candidates.length} candidates, threshold=${threshold}...`);

  // 1. 批�� embed 所有候选
  const texts = candidates.map(c => c.content);
  let embeddings: number[][];

  if (embeddingBackend.embedBatch) {
    embeddings = await embeddingBackend.embedBatch(texts);
  } else {
    embeddings = [];
    for (let i = 0; i < texts.length; i++) {
      if (i > 0 && i % 10 === 0) {
        console.error(`    Embedding progress: ${i}/${texts.length}...`);
      }
      embeddings.push(await embeddingBackend.embed(texts[i]));
    }
  }

  // 2. 两两比��，相���度 > threshold ���合并
  const kept: { candidate: CandidateWithSource; embedding: number[] }[] = [];

  for (let i = 0; i < candidates.length; i++) {
    let mergedWith: typeof kept[0] | null = null;

    for (const k of kept) {
      const sim = cosineSimilarity(embeddings[i], k.embedding);
      if (sim >= threshold) {
        mergedWith = k;
        break;
      }
    }

    if (mergedWith) {
      // 同义候选 → 应用"deterministic 原话优��"策��
      const incoming = candidates[i];
      const incomingSource = incoming._source;
      const keptSource = mergedWith.candidate._source;

      if (incomingSource === 'deterministic' && keptSource === 'llm') {
        // 替��：用 deterministic 原���覆盖 LLM 改写
        mergedWith.candidate = incoming;
        mergedWith.embedding = embeddings[i];
      }
      // 否��保留已有��先到���得 / deterministic 已存��）
    } else {
      kept.push({ candidate: candidates[i], embedding: embeddings[i] });
    }
  }

  console.error(`✓ Batch dedupe: ${candidates.length} → ${kept.length} unique candidates`);

  // 附加 embedding 到���选（��于后续库�� dedupe）
  return kept.map(k => ({ ...k.candidate, _embedding: k.embedding }));
}

/**
 * 主 pipeline 入���
 */
export async function runExtractionPipeline(
  blocks: ContentBlock[],
  opts: PipelineOptions
): Promise<ExtractionCandidate[]> {
  console.error(`\n🔍 Running extraction pipeline on ${blocks.length} content blocks...`);

  // Layer 1: Deterministic (现有��辑)
  console.error('\n📋 Layer 1: Deterministic extraction...');
  const deterministicCandidates = await runDeterministic(blocks);
  console.error(`✓ Deterministic: ${deterministicCandidates.length} candidates`);

  // Layer 2: LLM (如启用)
  let llmCandidates: CandidateWithSource[] = [];
  if (opts.config.llm.enabled && opts.llmBackend) {
    console.error('\n🤖 Layer 2: LLM extraction...');
    llmCandidates = await runLLMExtraction(blocks, opts.llmBackend);
  } else {
    console.error('\n⏭️  Layer 2: LLM extraction disabled');
  }

  // 合并候选
  const allCandidates = [
    ...deterministicCandidates,
    ...llmCandidates,
  ];

  console.error(`\n📊 Total candidates before dedupe: ${allCandidates.length}`);

  // Layer 3: Batch dedupe (本次提取内部去��)
  let deduplicated: CandidateWithSource[] = allCandidates;
  if (opts.config.embedding.enabled && opts.embeddingBackend) {
    console.error('\n🔗 Layer 3: Embedding-based batch dedupe...');
    deduplicated = await batchDedupe(
      allCandidates,
      opts.embeddingBackend,
      opts.config.embedding.similarityThreshold
    );
  } else {
    console.error('\n��️  Layer 3: Embedding dedupe disabled');
  }

  console.error(`\n✅ Pipeline complete: ${deduplicated.length} candidates ready for review\n`);

  // 移除内部��段 _source，保�� _embedding 供库级 dedupe 使用
  return deduplicated.map(c => {
    const { _source, ...rest } = c;
    return rest as ExtractionCandidate;
  });
}
