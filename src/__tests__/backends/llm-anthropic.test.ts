import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicLLMBackend } from '../../backends/llm/anthropic.js';

describe('AnthropicLLMBackend', () => {
  beforeEach(() => {
    global.fetch = mock.fn() as any;
  });

  describe('extract', () => {
    it('should parse valid response', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          content: [{
            text: JSON.stringify({
              items: [
                { type: 'preference', text: 'I prefer TypeScript' },
                { type: 'goal', text: 'Build a web app' },
              ],
            }),
          }],
        }),
      }));

      const backend = new AnthropicLLMBackend('claude-3-opus-20240229', 'test-key');
      const result = await backend.extract({ content: 'test' });

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].kind, 'preference');
      assert.strictEqual(result[1].kind, 'goal');
    });

    it('should extract JSON from markdown fences', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          content: [{
            text: '```json\n{"items": [{"type": "preference", "text": "test"}]}\n```',
          }],
        }),
      }));

      const backend = new AnthropicLLMBackend('claude-3-opus-20240229', 'test-key');
      const result = await backend.extract({ content: 'test' });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].kind, 'preference');
    });

    it('should return empty array on HTTP error', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
      }));

      const backend = new AnthropicLLMBackend('claude-3-opus-20240229', 'test-key');
      const result = await backend.extract({ content: 'test' });

      assert.deepStrictEqual(result, []);
    });

    it('should return empty array on JSON parse error', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          content: [{
            text: 'invalid json',
          }],
        }),
      }));

      const backend = new AnthropicLLMBackend('claude-3-opus-20240229', 'test-key');
      const result = await backend.extract({ content: 'test' });

      assert.deepStrictEqual(result, []);
    });
  });

  describe('healthCheck', () => {
    it('should return ok true on successful test request', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          content: [{ text: 'test' }],
        }),
      }));

      const backend = new AnthropicLLMBackend('claude-3-opus-20240229', 'test-key');
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

      const backend = new AnthropicLLMBackend('claude-3-opus-20240229', 'test-key');
      const result = await backend.healthCheck();

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'HTTP 401: Unauthorized');
    });
  });
});
