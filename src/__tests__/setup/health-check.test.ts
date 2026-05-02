// CT-0027-05: cortex setup health check tests
import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

describe('Setup Health Check', () => {
  it('LLM ok + Embedding ok → returns true', async () => {
    const mockLLM = {
      provider: 'ollama',
      model: 'qwen2.5:7b',
      async healthCheck() {
        return { ok: true };
      },
      async chat() {
        return { content: 'test' };
      },
    };

    const mockEmb = {
      provider: 'ollama',
      model: 'bge-m3',
      async healthCheck() {
        return { ok: true };
      },
      async embed() {
        return [0.1, 0.2];
      },
      async embedBatch() {
        return [[0.1, 0.2]];
      },
      async similarity() {
        return 0.9;
      },
    };

    const health1 = await mockLLM.healthCheck();
    const health2 = await mockEmb.healthCheck();

    assert.ok(health1.ok);
    assert.ok(health2.ok);
  });

  it('LLM fail → returns false', async () => {
    const mockLLM = {
      provider: 'ollama',
      model: 'qwen2.5:7b',
      async healthCheck() {
        return { ok: false, error: 'Connection refused' };
      },
      async chat() {
        return { content: 'test' };
      },
    };

    const health = await mockLLM.healthCheck();

    assert.equal(health.ok, false);
    assert.ok(health.error);
  });

  it('Embedding fail → returns false', async () => {
    const mockEmb = {
      provider: 'ollama',
      model: 'bge-m3',
      async healthCheck() {
        return { ok: false, error: 'Model not found' };
      },
      async embed() {
        return [0.1, 0.2];
      },
      async embedBatch() {
        return [[0.1, 0.2]];
      },
      async similarity() {
        return 0.9;
      },
    };

    const health = await mockEmb.healthCheck();

    assert.equal(health.ok, false);
    assert.ok(health.error);
  });
});
