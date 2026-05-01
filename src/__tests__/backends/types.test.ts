import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LLMBackend, EmbeddingBackend, LLMExtractionRequest } from '../../backends/types.js';

describe('Backend Types', () => {
  describe('LLMBackend interface', () => {
    it('should have correct contract', async () => {
      const mockBackend: LLMBackend = {
        provider: 'test',
        model: 'test-model',
        async extract(req: LLMExtractionRequest) {
          return [{ kind: 'preference', content: 'test' }];
        },
        async healthCheck() {
          return { ok: true };
        },
      };

      assert.strictEqual(mockBackend.provider, 'test');
      assert.strictEqual(mockBackend.model, 'test-model');

      const result = await mockBackend.extract({ content: 'test' });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].kind, 'preference');

      const health = await mockBackend.healthCheck();
      assert.strictEqual(health.ok, true);
    });
  });

  describe('EmbeddingBackend interface', () => {
    it('should have correct contract', async () => {
      const mockBackend: EmbeddingBackend = {
        provider: 'test',
        model: 'test-model',
        async embed(text: string) {
          return [0.1, 0.2, 0.3];
        },
        async embedBatch(texts: string[]) {
          return texts.map(() => [0.1, 0.2, 0.3]);
        },
        async similarity(a: string, b: string) {
          return 0.95;
        },
        async healthCheck() {
          return { ok: true };
        },
      };

      assert.strictEqual(mockBackend.provider, 'test');
      assert.strictEqual(mockBackend.model, 'test-model');

      const vec = await mockBackend.embed('test');
      assert.strictEqual(vec.length, 3);

      const batch = await mockBackend.embedBatch!(['a', 'b']);
      assert.strictEqual(batch.length, 2);

      const sim = await mockBackend.similarity('a', 'b');
      assert.strictEqual(sim, 0.95);

      const health = await mockBackend.healthCheck();
      assert.strictEqual(health.ok, true);
    });
  });
});
