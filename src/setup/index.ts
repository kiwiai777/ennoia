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
    console.log('��────��──���────��───��───��────��──���───��──���──��─');
    await runFullSetup(config, ollamaStatus);
  } else {
    displayCurrentConfig(config, ollamaStatus);
    const shouldModify = await askYesNo('是否���改配��？', false);

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
    console.log('\n配置已��存到 ~/.cortex/config.json');
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
  console.log('─���──��────��────��──���──��────��────────��──���───');
  console.log('当前���置：\n');

  const llmStatus = config.llm.provider === 'ollama' && ollamaStatus.available ? '✓ 可用' : '? 未检���';
  console.log(`LLM Backend：${config.llm.provider} (${config.llm.model})`);
  if (config.llm.endpoint) {
    console.log(`  端点��${config.llm.endpoint}`);
  }
  console.log(`  状态：${llmStatus}\n`);

  const embStatus = config.embedding.provider === 'ollama' && ollamaStatus.available ? '✓ 可用' : '? 未检��';
  console.log(`Embedding Backend：${config.embedding.provider} (${config.embedding.model})`);
  if (config.embedding.endpoint) {
    console.log(`  端��：${config.embedding.endpoint}`);
  }
  console.log(`  状态：${embStatus}\n`);

  console.log(`去重阈值��${config.embedding.similarityThreshold}`);
  console.log('──��──���──────��──���────��──��──���─────��──���───��─');
}

async function runFullSetup(
  config: CortexConfig,
  ollamaStatus: { available: boolean; models?: string[]; error?: string }
): Promise<void> {
  console.log('\n���择 LLM provider：\n');
  console.log('  [1] Ollama（��地，隐私��好）');
  console.log('      需���：本地运�� ollama，已 pull ��型（�� qwen2.5:7b��');
  if (ollamaStatus.available) {
    console.log(`      当前���态：✓ ollama 已检测��（模���：${ollamaStatus.models?.slice(0, 3).join(', ')}...）`);
  } else {
    console.log('      当前状态��✗ ollama 未���测到（请先��装：https://ollama.com）');
  }
  console.log('\n  [2] OpenAI');
  console.log('      需要��API key（https://platform.openai.com）\n');
  console.log('  [3] Anthropic');
  console.log('      需要：API key（https://console.anthropic.com）\n');
  console.log('  [4] DeepSeek');
  console.log('      需���：API key（https://platform.deepseek.com）\n');
  console.log('  [5] 智谱 GLM（通��版）');
  console.log('      需要���API key（https://open.bigmodel.cn���\n');
  console.log('  [6] 智谱 GLM（Coding Plan CN）');
  console.log('      需要���API key（https://open.bigmodel.cn/coding）\n');

  const providerChoice = await askChoice('请选择 [1-6]', ['1', '2', '3', '4', '5', '6']);

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

  const modelPrompt = `��入模型名��默认：${defaultModels[config.llm.provider]}）`;
  config.llm.model = await askString(modelPrompt, defaultModels[config.llm.provider]);

  if (config.llm.provider === 'ollama') {
    config.llm.endpoint = await askString('Ollama 端点（默认��http://localhost:11434）', 'http://localhost:11434');
    delete config.llm.apiKey;
  } else {
    config.llm.apiKey = await askPassword('请输入 API key（输���时不显示）');
    delete config.llm.endpoint;
  }

  console.log('\n选择 Embedding provider：\n');
  console.log('  [1] Ollama（���认，隐私��好）');
  console.log('      ���型：bge-m3（���荐）');
  if (ollamaStatus.available) {
    console.log('      当前���态：��');
  } else {
    console.log('      当前状态��✗');
  }
  console.log('\n  [2] 与 LLM 同 provider���如 OpenAI / DeepSeek / 智谱）');
  console.log('      使用 LLM provider �� embedding API���如果支持��\n');
  console.log('  注意：Anthropic 没有 embedding API，���须单独选 Embedding provider。\n');

  const embChoice = await askChoice('请选择 [1-2]', ['1', '2']);

  if (embChoice === '1') {
    config.embedding.provider = 'ollama';
    config.embedding.model = await askString('Ollama embedding 模型���默认：bge-m3��', 'bge-m3');
    config.embedding.endpoint = await askString('Ollama 端���（默认：http://localhost:11434��', 'http://localhost:11434');
    delete config.embedding.apiKey;
  } else {
    if (config.llm.provider === 'anthropic') {
      console.log('\n⚠️  Anthropic 不支持 embedding API，将使用 Ollama');
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
        `Embedding 模型（��认：${embDefaultModels[config.embedding.provider] || 'text-embedding-3-small'}）`,
        embDefaultModels[config.embedding.provider] || 'text-embedding-3-small'
      );
      delete config.embedding.endpoint;
    }
  }

  const thresholdStr = await askString(
    '\nEmbedding 相似度��重阈���（0.0-1.0，默�� 0.85）\n���高越严格��减少��合并���，越低越��松（���并更多相似偏好��\n直接���车使用默认值',
    '0.85'
  );
  config.embedding.similarityThreshold = parseFloat(thresholdStr) || 0.85;
}

async function runHealthCheck(config: CortexConfig): Promise<boolean> {
  console.log('\n正在检查��置...');

  const llmBackend = createLLMBackend(config.llm);
  const llmResult = await llmBackend.healthCheck();
  if (llmResult.ok) {
    console.log(`��� LLM (${config.llm.provider} / ${config.llm.model})`);
  } else {
    console.log(`��� LLM (${config.llm.provider}): ${llmResult.error}`);
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
    console.log('\n✓ Cortex 已就绪。运�� cortex sync --from <adapter> 开始使��。');
  } else {
    console.log('\n✗ 配置���查失败。请根��上述���误信息修正��重新���行 cortex setup���');
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
          console.log(`无效选��，请���入 ${validChoices.join(' 或 ')}`);
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
