import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { detectOllama } from '../../backends/detect.js';

describe('Backend Detect', () => {
  beforeEach(() => {
    global.fetch = mock.fn() as any;
  });

  describe('detectOllama', () => {
    it('should return available true with models list on success', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          models: [
            { name: 'qwen2.5:7b' },
            { name: 'bge-m3' },
          ],
        }),
      }));

      const result = await detectOllama();

      assert.strictEqual(result.available, true);
      assert.deepStrictEqual(result.models, ['qwen2.5:7b', 'bge-m3']);
      assert.strictEqual(result.error, undefined);
    });

    it('should use custom endpoint', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ models: [] }),
      }));

      await detectOllama('http://custom:8080');

      const calls = (global.fetch as any).mock.calls;
      assert.ok(calls[0].arguments[0].includes('http://custom:8080/api/tags'));
    });

    it('should return available false on HTTP error', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      }));

      const result = await detectOllama();

      assert.strictEqual(result.available, false);
      assert.strictEqual(result.error, 'HTTP 500: Internal Server Error');
      assert.strictEqual(result.models, undefined);
    });

    it('should return available false on network error', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => {
        throw new Error('Connection refused');
      });

      const result = await detectOllama();

      assert.strictEqual(result.available, false);
      assert.strictEqual(result.error, 'Connection refused');
      assert.strictEqual(result.models, undefined);
    });

    it('should timeout after 3 seconds', async () => {
      (global.fetch as any).mock.mockImplementationOnce(({ signal }: any) => {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      });

      const result = await detectOllama();

      assert.strictEqual(result.available, false);
      assert.ok(result.error?.includes('abort') || result.error?.includes('Abort'));
    });

    it('should handle missing models array', async () => {
      (global.fetch as any).mock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({}),
      }));

      const result = await detectOllama();

      assert.strictEqual(result.available, true);
      assert.deepStrictEqual(result.models, []);
    });
  });
});
