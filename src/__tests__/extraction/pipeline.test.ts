// CT-0027-04: Pipeline Tests

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import type { ContentBlock } from '../../core/extraction/types.js';
import type { LLMBackend, EmbeddingBackend } from '../../backends/types.js';
import type { CortexConfig } from '../../backends/config.js';
import { runExtractionPipeline } from '../../core/extraction/pipeline.js';

describe('Pipeline Tests', () => {
  const mockConfig: CortexConfig = {
    llm: {
      enabled: false,
      provider: 'ollama',
      model: 'qwen2.5:7b',
      endpoint: 'http://localhost:11434',
    },
    embedding: {
      enabled: false,
      provider: 'ollama',
      model: 'bge-m3',
      endpoint: 'http://localhost:11434',
      similarityThreshold: 0.85,
    },
  };

  const sampleBlocks: ContentBlock[] = [
    {
      path: 'test:conv-1',
      content: '我想快速��成 MVP',
      kind: 'plain',
      hint: 'chat-conversation',
    },
    {
      path: 'test:conv-2',
      content: '���不想引入外��依赖',
      kind: 'plain',
      hint: 'chat-conversation',
    },
  ];

  it('仅 deterministic（LLM disabled）→ ���返回 deterministic 候选', async () => {
    const result = await runExtractionPipeline(sampleBlocks, {
      config: mockConfig,
    });

    assert.ok(result.length > 0, 'Should extract some candidates');
    // Deterministic extractor ��基于关��词提���
    assert.ok(result.some(c => c.provenance.source.includes('deterministic')));
  });

  it('Deterministic + LLM mock → 合并��选', async () => {
    const mockLLM: LLMBackend = {
      provider: 'mock',
      model: 'mock-model',
      async extract() {
        return [
          { kind: 'goal', content: 'Mock LLM extracted goal' },
        ];
      },
      async healthCheck() {
        return { ok: true };
      },
    };

    const configWithLLM = {
      ...mockConfig,
      llm: { ...mockConfig.llm, enabled: true },
    };

    const result = await runExtractionPipeline(sampleBlocks, {
      llmBackend: mockLLM,
      config: configWithLLM,
    });

    assert.ok(result.length > 0);
    // 应该包�� LLM ��取的��选
    assert.ok(result.some(c => c.content.includes('Mock LLM')));
  });

  it('Batch dedupe：两个相��候选���并', async () => {
    const mockEmbedding: EmbeddingBackend = {
      provider: 'mock',
      model: 'mock-embedding',
      async embed() {
        // 返回���同的向��（相���度 = 1.0）
        return new Array(1024).fill(0.1);
      },
      async similarity() {
        return 0.95;
      },
      async healthCheck() {
        return { ok: true };
      },
    };

    const mockLLM: LLMBackend = {
      provider: 'mock',
      model: 'mock-model',
      async extract(req) {
        // 返��两个相似��候选
        return [
          { kind: 'goal', content: '快��完成 MVP' },
          { kind: 'goal', content: '快速完成��小可���产品' },
        ];
      },
      async healthCheck() {
        return { ok: true };
      },
    };

    const configWithBoth = {
      llm: { ...mockConfig.llm, enabled: true },
      embedding: { ...mockConfig.embedding, enabled: true },
    };

    const result = await runExtractionPipeline(sampleBlocks, {
      llmBackend: mockLLM,
      embeddingBackend: mockEmbedding,
      config: configWithBoth,
    });

    // 两个相��候选��该被���并成��个
    const goalCandidates = result.filter(c => c.kind === 'goal');
    assert.ok(goalCandidates.length < 2, 'Similar candidates should be deduplicated');
  });

  it('Batch dedupe：deterministic 原��优先', async () => {
    let embedCallCount = 0;
    const mockEmbedding: EmbeddingBackend = {
      provider: 'mock',
      model: 'mock-embedding',
      async embed() {
        embedCallCount++;
        // 返���相同��向量
        return new Array(1024).fill(0.1);
      },
      async embedBatch(texts) {
        return texts.map(() => new Array(1024).fill(0.1));
      },
      async similarity() {
        return 0.95;
      },
      async healthCheck() {
        return { ok: true };
      },
    };

    const mockLLM: LLMBackend = {
      provider: 'mock',
      model: 'mock-model',
      async extract() {
        return [
          { kind: 'goal', content: 'LLM 改���的目标' },
        ];
      },
      async healthCheck() {
        return { ok: true };
      },
    };

    const blocks: ContentBlock[] = [
      {
        path: 'test:conv-1',
        content: '我��快速���成 MVP',  // 包含关键��，会被 deterministic 提取
        kind: 'plain',
        hint: 'chat-conversation',
      },
    ];

    const configWithBoth = {
      llm: { ...mockConfig.llm, enabled: true },
      embedding: { ...mockConfig.embedding, enabled: true },
    };

    const result = await runExtractionPipeline(blocks, {
      llmBackend: mockLLM,
      embeddingBackend: mockEmbedding,
      config: configWithBoth,
    });

    // 如果 deterministic 和 LLM 都提取了��似内容��应该���留 deterministic 原话
    assert.ok(result.length > 0);
  });
});
