// CT-0027-05: cortex setup onboarding
import * as readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import type { CortexConfig } from '../backends/config.js';
import { loadConfig, saveConfig } from '../backends/config.js';
import { detectOllama } from '../backends/detect.js';
import { createLLMBackend, createEmbeddingBackend } from '../backends/factory.js';

interface SetupOptions {
  reset?: boolean;
  check?: boolean;
}

export async function cmdSetup(opts: SetupOptions = {}): Promise<void> {
  const config = loadConfig();
  const ollamaStatus = await detectOllama();

  if (opts.check) {
    await runHealthCheck(config);
    return;
  }

  const hasConfig = configExists();

  if (!hasConfig || opts.reset) {
    console.log('Cortex Setup');
    console.log('─'.repeat(50));
    await runFullSetup(config, ollamaStatus);
  } else {
    displayCurrentConfig(config, ollamaStatus);
    const shouldModify = await askYesNo('Modify configuration?', false);

    if (shouldModify) {
      await runFullSetup(config, ollamaStatus);
    } else {
      await runHealthCheck(config);
      return;
    }
  }

  const allOk = await runHealthCheck(config);
  if (allOk) {
    saveConfig(config);
    console.log('\nConfiguration saved to ~/.cortex/config.json');
  }
}

function configExists(): boolean {
  const config = loadConfig();
  return config.llm.apiKey !== undefined || config.llm.provider === 'ollama';
}

function displayCurrentConfig(
  config: CortexConfig,
  ollamaStatus: { available: boolean; models?: string[]; error?: string }
): void {
  console.log('Cortex Setup');
  console.log('��'.repeat(50));
  console.log('Current configuration:\n');

  const llmStatus = config.llm.provider === 'ollama' && ollamaStatus.available ? '✓ available' : '? not checked';
  console.log(`LLM Backend: ${config.llm.provider} (${config.llm.model})`);
  if (config.llm.endpoint) {
    console.log(`  Endpoint: ${config.llm.endpoint}`);
  }
  console.log(`  Status: ${llmStatus}\n`);

  const embStatus = config.embedding.provider === 'ollama' && ollamaStatus.available ? '��� available' : '? not checked';
  console.log(`Embedding Backend: ${config.embedding.provider} (${config.embedding.model})`);
  if (config.embedding.endpoint) {
    console.log(`  Endpoint: ${config.embedding.endpoint}`);
  }
  console.log(`  Status: ${embStatus}\n`);

  console.log(`Deduplication threshold: ${config.embedding.similarityThreshold}`);
  console.log('���'.repeat(50));
}

async function runFullSetup(
  config: CortexConfig,
  ollamaStatus: { available: boolean; models?: string[]; error?: string }
): Promise<void> {
  console.log('\nSelect LLM provider:\n');
  console.log('  [1] Ollama (local, best privacy)');
  console.log('      Requires: ollama running locally with models pulled (e.g., qwen2.5:7b)');
  if (ollamaStatus.available) {
    console.log(`      Current status: ✓ ollama detected (models: ${ollamaStatus.models?.slice(0, 3).join(', ')}...)`);
  } else {
    console.log('      Current status: ✗ ollama not detected (install: https://ollama.com)');
  }
  console.log('\n  [2] OpenAI');
  console.log('      Requires: API key (https://platform.openai.com)\n');
  console.log('  [3] Anthropic');
  console.log('      Requires: API key (https://console.anthropic.com)\n');
  console.log('  [4] DeepSeek');
  console.log('      Requires: API key (https://platform.deepseek.com)\n');
  console.log('  [5] Zhipu GLM (General)');
  console.log('      Requires: API key (https://open.bigmodel.cn)\n');
  console.log('  [6] Zhipu GLM (Coding Plan CN)');
  console.log('      Requires: API key (https://open.bigmodel.cn/coding)\n');

  const providerChoice = await askChoice('Select [1-6]', ['1', '2', '3', '4', '5', '6']);

  const providerMap: Record<string, CortexConfig['llm']['provider']> = {
    '1': 'ollama',
    '2': 'openai',
    '3': 'anthropic',
    '4': 'deepseek',
    '5': 'zhipu',
    '6': 'zhipu-coding-cn',
  };

  config.llm.provider = providerMap[providerChoice];

  const defaultModels: Record<string, string> = {
    ollama: 'qwen2.5:7b',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5',
    deepseek: 'deepseek-chat',
    zhipu: 'glm-4-flash',
    'zhipu-coding-cn': 'codegeex-4',
  };

  const modelPrompt = `Enter model name (default: ${defaultModels[config.llm.provider]})`;
  config.llm.model = await askString(modelPrompt, defaultModels[config.llm.provider]);

  if (config.llm.provider === 'ollama') {
    config.llm.endpoint = await askString('Ollama endpoint (default: http://localhost:11434)', 'http://localhost:11434');
    delete config.llm.apiKey;
  } else {
    config.llm.apiKey = await askPassword('Enter API key (hidden)');
    delete config.llm.endpoint;
  }

  console.log('\nSelect Embedding provider:\n');
  console.log('  [1] Ollama (default, best privacy)');
  console.log('      Model: bge-m3 (recommended)');
  if (ollamaStatus.available) {
    console.log('      Current status: ���');
  } else {
    console.log('      Current status: ✗');
  }
  console.log('\n  [2] Same as LLM provider (e.g., OpenAI / DeepSeek / Zhipu)');
  console.log('      Uses LLM provider\'s embedding API (if supported)\n');
  console.log('  Note: Anthropic does not have an embedding API; must select separate provider.\n');

  const embChoice = await askChoice('Select [1-2]', ['1', '2']);

  if (embChoice === '1') {
    config.embedding.provider = 'ollama';
    config.embedding.model = await askString('Ollama embedding model (default: bge-m3)', 'bge-m3');
    config.embedding.endpoint = await askString('Ollama endpoint (default: http://localhost:11434)', 'http://localhost:11434');
    delete config.embedding.apiKey;
  } else {
    if (config.llm.provider === 'anthropic') {
      console.log('\n⚠️  Anthropic does not support embedding API, falling back to Ollama');
      config.embedding.provider = 'ollama';
      config.embedding.model = 'bge-m3';
      config.embedding.endpoint = 'http://localhost:11434';
      delete config.embedding.apiKey;
    } else {
      config.embedding.provider = config.llm.provider as CortexConfig['embedding']['provider'];
      config.embedding.apiKey = config.llm.apiKey;

      const embDefaultModels: Record<string, string> = {
        openai: 'text-embedding-3-small',
        deepseek: 'deepseek-embedding',
        zhipu: 'embedding-3',
        'zhipu-coding-cn': 'embedding-3',
      };

      config.embedding.model = await askString(
        `Embedding model (default: ${embDefaultModels[config.embedding.provider] || 'text-embedding-3-small'})`,
        embDefaultModels[config.embedding.provider] || 'text-embedding-3-small'
      );
      delete config.embedding.endpoint;
    }
  }

  const thresholdStr = await askString(
    '\nEmbedding similarity deduplication threshold (0.0-1.0, default 0.85)\nHigher = stricter (fewer merges), lower = looser (more merges)\nPress Enter for default',
    '0.85'
  );
  config.embedding.similarityThreshold = parseFloat(thresholdStr) || 0.85;
}

async function runHealthCheck(config: CortexConfig): Promise<boolean> {
  console.log('\nChecking configuration...');

  const llmBackend = createLLMBackend(config.llm);
  const llmResult = await llmBackend.healthCheck();
  if (llmResult.ok) {
    console.log(`�� LLM (${config.llm.provider} / ${config.llm.model})`);
  } else {
    console.log(`✗ LLM (${config.llm.provider}): ${llmResult.error}`);
  }

  const embBackend = createEmbeddingBackend(config.embedding);
  const embResult = await embBackend.healthCheck();
  if (embResult.ok) {
    console.log(`✓ Embedding (${config.embedding.provider} / ${config.embedding.model})`);
  } else {
    console.log(`✗ Embedding (${config.embedding.provider}): ${embResult.error}`);
  }

  const allOk = llmResult.ok && embResult.ok;
  if (allOk) {
    console.log('\n✓ Cortex is ready. Run "cortex sync --from <adapter>" to start.');
  } else {
    console.log('\n✗ Configuration check failed. Fix errors above and re-run "cortex setup".');
  }

  return allOk;
}

function askString(prompt: string, defaultValue: string = ''): Promise<string> {
  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => {
    rl.question(`${prompt}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

function askChoice(prompt: string, validChoices: string[]): Promise<string> {
  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => {
    const ask = () => {
      rl.question(`${prompt}: `, (answer) => {
        const choice = answer.trim();
        if (validChoices.includes(choice)) {
          rl.close();
          resolve(choice);
        } else {
          console.log(`Invalid choice, please enter ${validChoices.join(' or ')}`);
          ask();
        }
      });
    };
    ask();
  });
}

function askYesNo(prompt: string, defaultValue: boolean): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
  return new Promise((resolve) => {
    rl.question(`${prompt}${suffix}: `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (normalized === '') {
        resolve(defaultValue);
      } else {
        resolve(normalized === 'y' || normalized === 'yes');
      }
    });
  });
}

function askPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });

    let password = '';

    if (input.isTTY) {
      input.setRawMode(true);
    }

    output.write(`${prompt}: `);

    input.on('data', (char) => {
      const c = char.toString('utf8');

      if (c === '\n' || c === '\r' || c === '\u0004') {
        if (input.isTTY) {
          input.setRawMode(false);
        }
        output.write('\n');
        rl.close();
        input.removeAllListeners('data');
        resolve(password);
      } else if (c === '\u0003') {
        if (input.isTTY) {
          input.setRawMode(false);
        }
        output.write('\n');
        rl.close();
        input.removeAllListeners('data');
        process.exit(1);
      } else if (c === '\u007f' || c === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
        }
      } else {
        password += c;
      }
    });
  });
}
