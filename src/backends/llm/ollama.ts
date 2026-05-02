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

export class OllamaLLMBackend implements LLMBackend {
  readonly provider = 'ollama';

  constructor(
    readonly model: string,
    private endpoint: string
  ) {}

  async extract(req: LLMExtractionRequest): Promise<LLMExtractionCandidate[]> {
    const prompt = EXTRACTION_PROMPT_TEMPLATE.replace('{content}', req.content);

    try {
      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
          options: {
            temperature: 0.1,
            seed: 42,
          },
        }),
      });

      if (!response.ok) {
        console.warn(`Ollama LLM request failed: ${response.status}`);
        return [];
      }

      const data = await response.json();
      const parsed = JSON.parse(data.response);

      if (!parsed.items || !Array.isArray(parsed.items)) {
        return [];
      }

      return parsed.items;
    } catch (error) {
      console.warn('Ollama LLM extraction failed:', error);
      return [];
    }
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);

      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json();
      const models = data.models?.map((m: any) => m.name) || [];

      // Normalize model name: if config model has no tag, append ":latest"
      const normalizedConfigModel = this.model.includes(':') ? this.model : `${this.model}:latest`;

      // Check if any model in the list matches (exact match or prefix match)
      const modelExists = models.some((m: string) => {
        const normalizedM = m.includes(':') ? m : `${m}:latest`;
        return normalizedM === normalizedConfigModel || m.split(':')[0] === this.model.split(':')[0];
      });

      if (!modelExists) {
        return {
          ok: false,
          error: `Model "${this.model}" not found in Ollama`,
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
