import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaEmbeddingBackend } from '../../backends/embedding/ollama.js';

describe('OllamaEmbeddingBackend', () => {
  beforeEach(() => {
    global.fetch = mock.fn() as any;
  });

  describe('embed', () => {
    it('should return embedding vector', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          embeddings: [[0.1, 0.2, 0.3, 0.4, 0.5]],
        }),
      }));

      const backend = new OllamaEmbeddingBackend('bge-m3', 'http://localhost:11434');
      const result = await backend.embed('test text');

      assert.deepStrictEqual(result, [0.1, 0.2, 0.3, 0.4, 0.5]);
    });

    it('should throw on HTTP error', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      }));

      const backend = new OllamaEmbeddingBackend('bge-m3', 'http://localhost:11434');

      await assert.rejects(backend.embed('test'), /Ollama embedding failed/);
    });
  });

  describe('embedBatch', () => {
    it('should return multiple embedding vectors', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          embeddings: [
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
            [0.7, 0.8, 0.9],
          ],
        }),
      }));

      const backend = new OllamaEmbeddingBackend('bge-m3', 'http://localhost:11434');
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
          embeddings: [
            [1, 0, 0],
            [1, 0, 0],
          ],
        }),
      }));

      const backend = new OllamaEmbeddingBackend('bge-m3', 'http://localhost:11434');
      const result = await backend.similarity('text1', 'text2');

      assert.strictEqual(result, 1);
    });

    it('should compute similarity for orthogonal vectors', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          embeddings: [
            [1, 0, 0],
            [0, 1, 0],
          ],
        }),
      }));

      const backend = new OllamaEmbeddingBackend('bge-m3', 'http://localhost:11434');
      const result = await backend.similarity('text1', 'text2');

      assert.strictEqual(result, 0);
    });

    it('should compute similarity for opposite vectors', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          embeddings: [
            [1, 0, 0],
            [-1, 0, 0],
          ],
        }),
      }));

      const backend = new OllamaEmbeddingBackend('bge-m3', 'http://localhost:11434');
      const result = await backend.similarity('text1', 'text2');

      assert.strictEqual(result, -1);
    });
  });

  describe('healthCheck', () => {
    it('should return ok true when model exists', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          models: [
            { name: 'bge-m3' },
            { name: 'qwen2.5:7b' },
          ],
        }),
      }));

      const backend = new OllamaEmbeddingBackend('bge-m3', 'http://localhost:11434');
      const result = await backend.healthCheck();

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.error, undefined);
    });

    it('should return ok false when model not found', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          models: [
            { name: 'other-model' },
          ],
        }),
      }));

      const backend = new OllamaEmbeddingBackend('bge-m3', 'http://localhost:11434');
      const result = await backend.healthCheck();

      assert.strictEqual(result.ok, false);
      assert.ok(result.error?.includes('not found'));
    });
  });
});
