import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatLLMBackend } from '../../backends/llm/openai-compat.js';

describe('OpenAICompatLLMBackend', () => {
  beforeEach(() => {
    global.fetch = mock.fn() as any;
  });

  describe('factory methods', () => {
    it('should create backends with correct providers', () => {
      const openai = OpenAICompatLLMBackend.forOpenAI('gpt-4', 'test-key');
      assert.strictEqual(openai.provider, 'openai');

      const deepseek = OpenAICompatLLMBackend.forDeepSeek('deepseek-chat', 'test-key');
      assert.strictEqual(deepseek.provider, 'deepseek');

      const zhipu = OpenAICompatLLMBackend.forZhipu('glm-4', 'test-key');
      assert.strictEqual(zhipu.provider, 'zhipu');

      const zhipuCoding = OpenAICompatLLMBackend.forZhipuCodingCN('glm-4', 'test-key');
      assert.strictEqual(zhipuCoding.provider, 'zhipu-coding-cn');
    });
  });

  describe('extract', () => {
    it('should parse valid response', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                items: [
                  { kind: 'preference', content: 'I prefer TypeScript' },
                  { kind: 'goal', content: 'Build a web app' },
                ],
              }),
            },
          }],
        }),
      }));

      const backend = OpenAICompatLLMBackend.forOpenAI('gpt-4', 'test-key');
      const result = await backend.extract({ content: 'test' });

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].kind, 'preference');
      assert.strictEqual(result[1].kind, 'goal');
    });

    it('should extract JSON from markdown fences', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '```json\n{"items": [{"kind": "preference", "content": "test"}]}\n```',
            },
          }],
        }),
      }));

      const backend = OpenAICompatLLMBackend.forOpenAI('gpt-4', 'test-key');
      const result = await backend.extract({ content: 'test' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].kind, 'preference');
    });

    it('should return empty array on HTTP error', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
      }));

      const backend = OpenAICompatLLMBackend.forOpenAI('gpt-4', 'test-key');
      const result = await backend.extract({ content: 'test' });

      assert.deepStrictEqual(result, []);
    });
  });

  describe('healthCheck', () => {
    it('should return ok true on successful request', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ data: [] }),
      }));

      const backend = OpenAICompatLLMBackend.forOpenAI('gpt-4', 'test-key');
      const result = await backend.healthCheck();

      assert.strictEqual(result.ok, true);
    });

    it('should return ok false on HTTP error', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      }));

      const backend = OpenAICompatLLMBackend.forOpenAI('gpt-4', 'test-key');
      const result = await backend.healthCheck();

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'HTTP 401: Unauthorized');
    });
  });
});
