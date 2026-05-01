import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatEmbeddingBackend } from '../../backends/embedding/openai-compat.js';

describe('OpenAICompatEmbeddingBackend', () => {
  beforeEach(() => {
    global.fetch = mock.fn() as any;
  });

  describe('factory methods', () => {
    it('should create backends with correct providers', () => {
      const openai = OpenAICompatEmbeddingBackend.forOpenAI('text-embedding-3-small', 'test-key');
      assert.strictEqual(openai.provider, 'openai');

      const deepseek = OpenAICompatEmbeddingBackend.forDeepSeek('deepseek-embedding', 'test-key');
      assert.strictEqual(deepseek.provider, 'deepseek');

      const zhipu = OpenAICompatEmbeddingBackend.forZhipu('embedding-2', 'test-key');
      assert.strictEqual(zhipu.provider, 'zhipu');

      const zhipuCoding = OpenAICompatEmbeddingBackend.forZhipuCodingCN('embedding-2', 'test-key');
      assert.strictEqual(zhipuCoding.provider, 'zhipu-coding-cn');
    });
  });

  describe('embed', () => {
    it('should return embedding vector', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }],
        }),
      }));

      const backend = OpenAICompatEmbeddingBackend.forOpenAI('text-embedding-3-small', 'test-key');
      const result = await backend.embed('test text');

      assert.deepStrictEqual(result, [0.1, 0.2, 0.3, 0.4, 0.5]);
    });

    it('should throw on HTTP error', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      }));

      const backend = OpenAICompatEmbeddingBackend.forOpenAI('text-embedding-3-small', 'test-key');

      await assert.rejects(backend.embed('test'), /openai embedding failed/);
    });
  });

  describe('embedBatch', () => {
    it('should return multiple embedding vectors', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          data: [
            { embedding: [0.1, 0.2, 0.3] },
            { embedding: [0.4, 0.5, 0.6] },
            { embedding: [0.7, 0.8, 0.9] },
          ],
        }),
      }));

      const backend = OpenAICompatEmbeddingBackend.forOpenAI('text-embedding-3-small', 'test-key');
      const result = await backend.embedBatch(['text1', 'text2', 'text3']);

      assert.strictEqual(result.length, 3);
      assert.deepStrictEqual(result[0], [0.1, 0.2, 0.3]);
      assert.deepStrictEqual(result[1], [0.4, 0.5, 0.6]);
      assert.deepStrictEqual(result[2], [0.7, 0.8, 0.9]);
    });
  });

  describe('similarity', () => {
    it('should compute cosine similarity for identical vectors', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          data: [
            { embedding: [1, 0, 0] },
            { embedding: [1, 0, 0] },
          ],
        }),
      }));

      const backend = OpenAICompatEmbeddingBackend.forOpenAI('text-embedding-3-small', 'test-key');
      const result = await backend.similarity('text1', 'text2');

      assert.strictEqual(result, 1);
    });

    it('should compute similarity for orthogonal vectors', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          data: [
            { embedding: [1, 0, 0] },
            { embedding: [0, 1, 0] },
          ],
        }),
      }));

      const backend = OpenAICompatEmbeddingBackend.forOpenAI('text-embedding-3-small', 'test-key');
      const result = await backend.similarity('text1', 'text2');

      assert.strictEqual(result, 0);
    });

    it('should compute similarity for opposite vectors', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          data: [
            { embedding: [1, 0, 0] },
            { embedding: [-1, 0, 0] },
          ],
        }),
      }));

      const backend = OpenAICompatEmbeddingBackend.forOpenAI('text-embedding-3-small', 'test-key');
      const result = await backend.similarity('text1', 'text2');

      assert.strictEqual(result, -1);
    });
  });

  describe('healthCheck', () => {
    it('should return ok true on successful models request', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ data: [] }),
      }));

      const backend = OpenAICompatEmbeddingBackend.forOpenAI('text-embedding-3-small', 'test-key');
      const result = await backend.healthCheck();

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.error, undefined);
    });

    it('should return ok false on HTTP error', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      }));

      const backend = OpenAICompatEmbeddingBackend.forOpenAI('text-embedding-3-small', 'test-key');
      const result = await backend.healthCheck();

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'HTTP 401: Unauthorized');
    });
  });
});
