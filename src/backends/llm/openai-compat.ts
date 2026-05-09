import { LLMBackend, LLMExtractionRequest, LLMExtractionCandidate } from '../types';
import { EXTRACTION_SYSTEM_PROMPT } from '../../core/extraction/prompts.js';

export class OpenAICompatLLMBackend implements LLMBackend {
  readonly provider: string;
  readonly model: string;
  private endpoint: string;
  private apiKey: string;

  private constructor(provider: string, model: string, endpoint: string, apiKey: string) {
    this.provider = provider;
    this.model = model;
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  static forOpenAI(model: string, apiKey: string): OpenAICompatLLMBackend {
    return new OpenAICompatLLMBackend('openai', model, 'https://api.openai.com/v1', apiKey);
  }

  static forDeepSeek(model: string, apiKey: string): OpenAICompatLLMBackend {
    return new OpenAICompatLLMBackend('deepseek', model, 'https://api.deepseek.com/v1', apiKey);
  }

  static forZhipu(model: string, apiKey: string): OpenAICompatLLMBackend {
    return new OpenAICompatLLMBackend(
      'zhipu',
      model,
      'https://open.bigmodel.cn/api/paas/v4',
      apiKey
    );
  }

  static forZhipuCodingCN(model: string, apiKey: string): OpenAICompatLLMBackend {
    return new OpenAICompatLLMBackend(
      'zhipu-coding-cn',
      model,
      'https://open.bigmodel.cn/api/coding/paas/v4',
      apiKey
    );
  }

  async extract(req: LLMExtractionRequest): Promise<LLMExtractionCandidate[]> {
    try {
      const body: any = {
        model: this.model,
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: req.content }
        ],
        temperature: 0.1,
      };

      if (this.provider === 'openai' || this.provider === 'deepseek') {
        body.response_format = { type: 'json_object' };
      }

      const response = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        console.warn(`${this.provider} LLM request failed: ${response.status}`);
        return [];
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        return [];
      }

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : content;
      const parsed = JSON.parse(jsonStr);

      if (!parsed.items || !Array.isArray(parsed.items)) {
        return [];
      }

      // Map prompt response format to LLMExtractionCandidate
      return parsed.items.map((item: any) => ({
        kind: item.type || 'preference',
        content: item.text || '',
      }));
    } catch (error) {
      console.warn(`${this.provider} LLM extraction failed:`, error);
      return [];
    }
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.endpoint}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
