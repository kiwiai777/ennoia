import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, saveConfig, DEFAULT_CONFIG, requireApiKey, CortexConfig } from '../../backends/config.js';

describe('Backend Config', () => {
  const testConfigDir = path.join(os.tmpdir(), '.cortex-test-' + Date.now());
  const testConfigPath = path.join(testConfigDir, 'config.json');
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = os.tmpdir();

    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true });
    }
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have correct default values', () => {
      assert.strictEqual(DEFAULT_CONFIG.llm.enabled, true);
      assert.strictEqual(DEFAULT_CONFIG.llm.provider, 'ollama');
      assert.strictEqual(DEFAULT_CONFIG.llm.model, 'qwen2.5:7b');
      assert.strictEqual(DEFAULT_CONFIG.llm.endpoint, 'http://localhost:11434');

      assert.strictEqual(DEFAULT_CONFIG.embedding.enabled, true);
      assert.strictEqual(DEFAULT_CONFIG.embedding.provider, 'ollama');
      assert.strictEqual(DEFAULT_CONFIG.embedding.model, 'bge-m3');
      assert.strictEqual(DEFAULT_CONFIG.embedding.endpoint, 'http://localhost:11434');
      assert.strictEqual(DEFAULT_CONFIG.embedding.similarityThreshold, 0.85);
    });
  });

  describe('loadConfig', () => {
    it('should return DEFAULT_CONFIG when file does not exist', () => {
      const config = loadConfig();
      assert.deepStrictEqual(config, DEFAULT_CONFIG);
    });

    it('should merge partial config with defaults', () => {
      fs.mkdirSync(path.join(os.tmpdir(), '.cortex'), { recursive: true });
      const partial = {
        llm: { provider: 'openai' as const, model: 'gpt-4' },
      };
      fs.writeFileSync(
        path.join(os.tmpdir(), '.cortex', 'config.json'),
        JSON.stringify(partial)
      );

      const config = loadConfig();
      assert.strictEqual(config.llm.provider, 'openai');
      assert.strictEqual(config.llm.model, 'gpt-4');
      assert.strictEqual(config.llm.enabled, true);
      assert.deepStrictEqual(config.embedding, DEFAULT_CONFIG.embedding);
    });

    it('should return DEFAULT_CONFIG on parse error', () => {
      fs.mkdirSync(path.join(os.tmpdir(), '.cortex'), { recursive: true });
      fs.writeFileSync(
        path.join(os.tmpdir(), '.cortex', 'config.json'),
        'invalid json'
      );

      const config = loadConfig();
      assert.deepStrictEqual(config, DEFAULT_CONFIG);
    });
  });

  describe('saveConfig', () => {
    it('should create directory if not exists', () => {
      const config: CortexConfig = { ...DEFAULT_CONFIG };
      saveConfig(config);

      const configDir = path.join(os.tmpdir(), '.cortex');
      assert.strictEqual(fs.existsSync(configDir), true);
    });

    it('should write config atomically', () => {
      const config: CortexConfig = {
        ...DEFAULT_CONFIG,
        llm: { ...DEFAULT_CONFIG.llm, model: 'custom-model' },
      };

      saveConfig(config);

      const configPath = path.join(os.tmpdir(), '.cortex', 'config.json');
      assert.strictEqual(fs.existsSync(configPath), true);

      const loaded = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.strictEqual(loaded.llm.model, 'custom-model');
    });

    it('should not leave tmp file after save', () => {
      const config: CortexConfig = { ...DEFAULT_CONFIG };
      saveConfig(config);

      const tmpPath = path.join(os.tmpdir(), '.cortex', 'config.json.tmp');
      assert.strictEqual(fs.existsSync(tmpPath), false);
    });
  });

  describe('requireApiKey', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return apiKey from config if present', () => {
      const config = {
        enabled: true,
        provider: 'openai' as const,
        model: 'gpt-4',
        apiKey: 'config-key',
      };

      assert.strictEqual(requireApiKey(config), 'config-key');
    });

    it('should return apiKey from environment variable', () => {
      process.env.CORTEX_OPENAI_API_KEY = 'env-key';

      const config = {
        enabled: true,
        provider: 'openai' as const,
        model: 'gpt-4',
      };

      assert.strictEqual(requireApiKey(config), 'env-key');
    });

    it('should prioritize config over environment', () => {
      process.env.CORTEX_OPENAI_API_KEY = 'env-key';

      const config = {
        enabled: true,
        provider: 'openai' as const,
        model: 'gpt-4',
        apiKey: 'config-key',
      };

      assert.strictEqual(requireApiKey(config), 'config-key');
    });

    it('should throw if no apiKey found', () => {
      const config = {
        enabled: true,
        provider: 'openai' as const,
        model: 'gpt-4',
      };

      assert.throws(() => requireApiKey(config), /API key required/);
    });

    it('should use correct env var for each provider', () => {
      const providers = [
        { provider: 'openai' as const, envVar: 'CORTEX_OPENAI_API_KEY' },
        { provider: 'anthropic' as const, envVar: 'CORTEX_ANTHROPIC_API_KEY' },
        { provider: 'deepseek' as const, envVar: 'CORTEX_DEEPSEEK_API_KEY' },
        { provider: 'zhipu' as const, envVar: 'CORTEX_ZHIPU_API_KEY' },
        { provider: 'zhipu-coding-cn' as const, envVar: 'CORTEX_ZHIPU_API_KEY' },
      ];

      providers.forEach(({ provider, envVar }) => {
        process.env = { ...originalEnv };
        process.env[envVar] = 'test-key';

        const config = {
          enabled: true,
          provider,
          model: 'test-model',
        };

        assert.strictEqual(requireApiKey(config), 'test-key');
      });
    });
  });
});
