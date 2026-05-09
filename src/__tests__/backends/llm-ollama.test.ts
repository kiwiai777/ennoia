import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaLLMBackend } from '../../backends/llm/ollama.js';

describe('OllamaLLMBackend', () => {
  beforeEach(() => {
    global.fetch = mock.fn() as any;
  });

  describe('extract', () => {
    it('should send correct request and parse response', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          response: JSON.stringify({
            items: [
              { type: 'preference', text: 'I prefer TypeScript' },
            ],
          }),
        }),
      }));

      const backend = new OllamaLLMBackend('qwen2.5:7b', 'http://localhost:11434');
      const result = await backend.extract({ content: 'I prefer TypeScript' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].kind, 'preference');
      assert.strictEqual(result[0].content, 'I prefer TypeScript');
    });

    it('should return empty array on HTTP error', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
      }));

      const backend = new OllamaLLMBackend('qwen2.5:7b', 'http://localhost:11434');
      const result = await backend.extract({ content: 'test' });

      assert.deepStrictEqual(result, []);
    });

    it('should return empty array on JSON parse error', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          response: 'invalid json',
        }),
      }));

      const backend = new OllamaLLMBackend('qwen2.5:7b', 'http://localhost:11434');
      const result = await backend.extract({ content: 'test' });

      assert.deepStrictEqual(result, []);
    });
  });

  describe('healthCheck', () => {
    it('should return ok true when model exists', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          models: [
            { name: 'qwen2.5:7b' },
            { name: 'bge-m3' },
          ],
        }),
      }));

      const backend = new OllamaLLMBackend('qwen2.5:7b', 'http://localhost:11434');
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

      const backend = new OllamaLLMBackend('qwen2.5:7b', 'http://localhost:11434');
      const result = await backend.healthCheck();

      assert.strictEqual(result.ok, false);
      assert.ok(result.error?.includes('not found'));
    });
  });
});
