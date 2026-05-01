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

export class AnthropicLLMBackend implements LLMBackend {
  readonly provider = 'anthropic';

  constructor(
    readonly model: string,
    private apiKey: string
  ) {}

  async extract(req: LLMExtractionRequest): Promise<LLMExtractionCandidate[]> {
    const prompt = EXTRACTION_PROMPT_TEMPLATE.replace('{content}', req.content);

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
          messages: [{ role: 'user', content: prompt }],
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
