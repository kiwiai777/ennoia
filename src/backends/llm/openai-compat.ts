import { LLMBackend, LLMExtractionRequest, LLMExtractionCandidate } from '../types';

const EXTRACTION_PROMPT_TEMPLATE = `Extract user preferences, goals, and constraints from the following text.
Output strictly in JSON format with this schema:
{
  "items": [
    {"kind": "preference|goal|constraint", "content": "<extracted text>"}
  ]
}

Rules:
- Only extract clearly stated or strongly implied user preferences
- "kind" must be exactly one of: preference, goal, constraint
- Do not invent information not in the text
- If no preferences found, return {"items": []}
- Return raw JSON only, no markdown fences

Text:
"""
{content}
"""`;

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
    const prompt = EXTRACTION_PROMPT_TEMPLATE.replace('{content}', req.content);

    try {
      const body: any = {
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
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

      return parsed.items;
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
