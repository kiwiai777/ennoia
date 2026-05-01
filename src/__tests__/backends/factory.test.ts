import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLLMBackend, createEmbeddingBackend } from '../../backends/factory.js';
import { CortexConfig } from '../../backends/config.js';
import { OllamaLLMBackend } from '../../backends/llm/ollama.js';
import { OpenAICompatLLMBackend } from '../../backends/llm/openai-compat.js';
import { AnthropicLLMBackend } from '../../backends/llm/anthropic.js';
import { OllamaEmbeddingBackend } from '../../backends/embedding/ollama.js';
import { OpenAICompatEmbeddingBackend } from '../../backends/embedding/openai-compat.js';

describe('Backend Factory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createLLMBackend', () => {
    it('should create OllamaLLMBackend for ollama provider', () => {
      const config: CortexConfig['llm'] = {
        enabled: true,
        provider: 'ollama',
        model: 'qwen2.5:7b',
        endpoint: 'http://localhost:11434',
      };

      const backend = createLLMBackend(config);

      assert.ok(backend instanceof OllamaLLMBackend);
      assert.strictEqual(backend.provider, 'ollama');
      assert.strictEqual(backend.model, 'qwen2.5:7b');
    });

    it('should create OpenAICompatLLMBackend for openai provider', () => {
      process.env.CORTEX_OPENAI_API_KEY = 'test-key';

      const config: CortexConfig['llm'] = {
        enabled: true,
        provider: 'openai',
        model: 'gpt-4',
      };

      const backend = createLLMBackend(config);

      assert.ok(backend instanceof OpenAICompatLLMBackend);
      assert.strictEqual(backend.provider, 'openai');
      assert.strictEqual(backend.model, 'gpt-4');
    });

    it('should create AnthropicLLMBackend for anthropic provider', () => {
      process.env.CORTEX_ANTHROPIC_API_KEY = 'test-key';

      const config: CortexConfig['llm'] = {
        enabled: true,
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
      };

      const backend = createLLMBackend(config);

      assert.ok(backend instanceof AnthropicLLMBackend);
      assert.strictEqual(backend.provider, 'anthropic');
      assert.strictEqual(backend.model, 'claude-3-opus-20240229');
    });

    it('should create OpenAICompatLLMBackend for deepseek provider', () => {
      process.env.CORTEX_DEEPSEEK_API_KEY = 'test-key';

      const config: CortexConfig['llm'] = {
        enabled: true,
        provider: 'deepseek',
        model: 'deepseek-chat',
      };

      const backend = createLLMBackend(config);

      assert.ok(backend instanceof OpenAICompatLLMBackend);
      assert.strictEqual(backend.provider, 'deepseek');
      assert.strictEqual(backend.model, 'deepseek-chat');
    });

    it('should create OpenAICompatLLMBackend for zhipu provider', () => {
      process.env.CORTEX_ZHIPU_API_KEY = 'test-key';

      const config: CortexConfig['llm'] = {
        enabled: true,
        provider: 'zhipu',
        model: 'glm-4',
      };

      const backend = createLLMBackend(config);

      assert.ok(backend instanceof OpenAICompatLLMBackend);
      assert.strictEqual(backend.provider, 'zhipu');
      assert.strictEqual(backend.model, 'glm-4');
    });

    it('should create OpenAICompatLLMBackend for zhipu-coding-cn provider', () => {
      process.env.CORTEX_ZHIPU_API_KEY = 'test-key';

      const config: CortexConfig['llm'] = {
        enabled: true,
        provider: 'zhipu-coding-cn',
        model: 'glm-4',
      };

      const backend = createLLMBackend(config);

      assert.ok(backend instanceof OpenAICompatLLMBackend);
      assert.strictEqual(backend.provider, 'zhipu-coding-cn');
      assert.strictEqual(backend.model, 'glm-4');
    });

    it('should throw on unknown provider', () => {
      const config: any = {
        enabled: true,
        provider: 'unknown',
        model: 'test',
      };

      assert.throws(() => createLLMBackend(config), /Unknown LLM provider/);
    });
  });

  describe('createEmbeddingBackend', () => {
    it('should create OllamaEmbeddingBackend for ollama provider', () => {
      const config: CortexConfig['embedding'] = {
        enabled: true,
        provider: 'ollama',
        model: 'bge-m3',
        endpoint: 'http://localhost:11434',
        similarityThreshold: 0.85,
      };

      const backend = createEmbeddingBackend(config);

      assert.ok(backend instanceof OllamaEmbeddingBackend);
      assert.strictEqual(backend.provider, 'ollama');
      assert.strictEqual(backend.model, 'bge-m3');
    });

    it('should create OpenAICompatEmbeddingBackend for openai provider', () => {
      process.env.CORTEX_OPENAI_API_KEY = 'test-key';

      const config: CortexConfig['embedding'] = {
        enabled: true,
        provider: 'openai',
        model: 'text-embedding-3-small',
        similarityThreshold: 0.85,
      };

      const backend = createEmbeddingBackend(config);

      assert.ok(backend instanceof OpenAICompatEmbeddingBackend);
      assert.strictEqual(backend.provider, 'openai');
      assert.strictEqual(backend.model, 'text-embedding-3-small');
    });

    it('should create OpenAICompatEmbeddingBackend for deepseek provider', () => {
      process.env.CORTEX_DEEPSEEK_API_KEY = 'test-key';

      const config: CortexConfig['embedding'] = {
        enabled: true,
        provider: 'deepseek',
        model: 'deepseek-embedding',
        similarityThreshold: 0.85,
      };

      const backend = createEmbeddingBackend(config);

      assert.ok(backend instanceof OpenAICompatEmbeddingBackend);
      assert.strictEqual(backend.provider, 'deepseek');
    });

    it('should create OpenAICompatEmbeddingBackend for zhipu provider', () => {
      process.env.CORTEX_ZHIPU_API_KEY = 'test-key';

      const config: CortexConfig['embedding'] = {
        enabled: true,
        provider: 'zhipu',
        model: 'embedding-2',
        similarityThreshold: 0.85,
      };

      const backend = createEmbeddingBackend(config);

      assert.ok(backend instanceof OpenAICompatEmbeddingBackend);
      assert.strictEqual(backend.provider, 'zhipu');
    });

    it('should create OpenAICompatEmbeddingBackend for zhipu-coding-cn provider', () => {
      process.env.CORTEX_ZHIPU_API_KEY = 'test-key';

      const config: CortexConfig['embedding'] = {
        enabled: true,
        provider: 'zhipu-coding-cn',
        model: 'embedding-2',
        similarityThreshold: 0.85,
      };

      const backend = createEmbeddingBackend(config);

      assert.ok(backend instanceof OpenAICompatEmbeddingBackend);
      assert.strictEqual(backend.provider, 'zhipu-coding-cn');
    });

    it('should throw on unknown provider', () => {
      const config: any = {
        enabled: true,
        provider: 'unknown',
        model: 'test',
        similarityThreshold: 0.85,
      };

      assert.throws(() => createEmbeddingBackend(config), /Unknown embedding provider/);
    });
  });
});
