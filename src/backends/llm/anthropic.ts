import { LLMBackend, LLMExtractionRequest, LLMExtractionCandidate } from '../types';
import { EXTRACTION_SYSTEM_PROMPT } from '../../core/extraction/prompts.js';

export class AnthropicLLMBackend implements LLMBackend {
  readonly provider = 'anthropic';

  constructor(
    readonly model: string,
    private apiKey: string
  ) {}

  async extract(req: LLMExtractionRequest): Promise<LLMExtractionCandidate[]> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          system: EXTRACTION_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: req.content }],
        }),
      });

      if (!response.ok) {
        console.warn(`Anthropic LLM request failed: ${response.status}`);
        return [];
      }

      const data = await response.json();
      const content = data.content?.[0]?.text;

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
      console.warn('Anthropic LLM extraction failed:', error);
      return [];
    }
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        }),
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
