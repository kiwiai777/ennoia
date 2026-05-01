import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CortexConfig {
  llm: {
    enabled: boolean;
    provider: 'ollama' | 'openai' | 'anthropic' | 'deepseek' | 'zhipu' | 'zhipu-coding-cn';
    model: string;
    endpoint?: string;
    apiKey?: string;
  };
  embedding: {
    enabled: boolean;
    provider: 'ollama' | 'openai' | 'deepseek' | 'zhipu' | 'zhipu-coding-cn';
    model: string;
    endpoint?: string;
    apiKey?: string;
    similarityThreshold: number;
  };
}

export const DEFAULT_CONFIG: CortexConfig = {
  llm: {
    enabled: true,
    provider: 'ollama',
    model: 'qwen2.5:7b',
    endpoint: 'http://localhost:11434',
  },
  embedding: {
    enabled: true,
    provider: 'ollama',
    model: 'bge-m3',
    endpoint: 'http://localhost:11434',
    similarityThreshold: 0.85,
  },
};

function getConfigPath(): string {
  return path.join(os.homedir(), '.cortex', 'config.json');
}

function mergeWithDefaults(partial: Partial<CortexConfig>): CortexConfig {
  return {
    llm: { ...DEFAULT_CONFIG.llm, ...partial.llm },
    embedding: { ...DEFAULT_CONFIG.embedding, ...partial.embedding },
  };
}

export function loadConfig(): CortexConfig {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const partial = JSON.parse(content);
    return mergeWithDefaults(partial);
  } catch (error) {
    console.warn(`Failed to load config from ${configPath}, using defaults:`, error);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: CortexConfig): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const tmpPath = `${configPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(tmpPath, configPath);
}

export function requireApiKey(config: CortexConfig['llm'] | CortexConfig['embedding']): string {
  if (config.apiKey) {
    return config.apiKey;
  }

  const envVarMap: Record<string, string> = {
    openai: 'CORTEX_OPENAI_API_KEY',
    anthropic: 'CORTEX_ANTHROPIC_API_KEY',
    deepseek: 'CORTEX_DEEPSEEK_API_KEY',
    zhipu: 'CORTEX_ZHIPU_API_KEY',
    'zhipu-coding-cn': 'CORTEX_ZHIPU_API_KEY',
  };

  const envVar = envVarMap[config.provider];
  if (envVar && process.env[envVar]) {
    return process.env[envVar]!;
  }

  throw new Error(
    `API key required for provider "${config.provider}". ` +
    `Set it in config.json or environment variable ${envVar || 'CORTEX_<PROVIDER>_API_KEY'}`
  );
}
