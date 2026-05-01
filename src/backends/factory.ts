import { LLMBackend, EmbeddingBackend } from './types';
import { CortexConfig, requireApiKey } from './config';
import { OllamaLLMBackend } from './llm/ollama';
import { OpenAICompatLLMBackend } from './llm/openai-compat';
import { AnthropicLLMBackend } from './llm/anthropic';
import { OllamaEmbeddingBackend } from './embedding/ollama';
import { OpenAICompatEmbeddingBackend } from './embedding/openai-compat';

export function createLLMBackend(config: CortexConfig['llm']): LLMBackend {
  switch (config.provider) {
    case 'ollama':
      return new OllamaLLMBackend(config.model, config.endpoint!);
    case 'openai':
      return OpenAICompatLLMBackend.forOpenAI(config.model, requireApiKey(config));
    case 'anthropic':
      return new AnthropicLLMBackend(config.model, requireApiKey(config));
    case 'deepseek':
      return OpenAICompatLLMBackend.forDeepSeek(config.model, requireApiKey(config));
    case 'zhipu':
      return OpenAICompatLLMBackend.forZhipu(config.model, requireApiKey(config));
    case 'zhipu-coding-cn':
      return OpenAICompatLLMBackend.forZhipuCodingCN(config.model, requireApiKey(config));
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unknown LLM provider: ${_exhaustive}`);
    }
  }
}

export function createEmbeddingBackend(config: CortexConfig['embedding']): EmbeddingBackend {
  switch (config.provider) {
    case 'ollama':
      return new OllamaEmbeddingBackend(config.model, config.endpoint!);
    case 'openai':
      return OpenAICompatEmbeddingBackend.forOpenAI(config.model, requireApiKey(config));
    case 'deepseek':
      return OpenAICompatEmbeddingBackend.forDeepSeek(config.model, requireApiKey(config));
    case 'zhipu':
      return OpenAICompatEmbeddingBackend.forZhipu(config.model, requireApiKey(config));
    case 'zhipu-coding-cn':
      return OpenAICompatEmbeddingBackend.forZhipuCodingCN(config.model, requireApiKey(config));
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unknown embedding provider: ${_exhaustive}`);
    }
  }
}
