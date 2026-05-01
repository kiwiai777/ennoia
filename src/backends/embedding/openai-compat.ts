import { EmbeddingBackend } from '../types';

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

export class OpenAICompatEmbeddingBackend implements EmbeddingBackend {
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

  static forOpenAI(model: string, apiKey: string): OpenAICompatEmbeddingBackend {
    return new OpenAICompatEmbeddingBackend('openai', model, 'https://api.openai.com/v1', apiKey);
  }

  static forDeepSeek(model: string, apiKey: string): OpenAICompatEmbeddingBackend {
    return new OpenAICompatEmbeddingBackend('deepseek', model, 'https://api.deepseek.com/v1', apiKey);
  }

  static forZhipu(model: string, apiKey: string): OpenAICompatEmbeddingBackend {
    return new OpenAICompatEmbeddingBackend(
      'zhipu',
      model,
      'https://open.bigmodel.cn/api/paas/v4',
      apiKey
    );
  }

  static forZhipuCodingCN(model: string, apiKey: string): OpenAICompatEmbeddingBackend {
    return new OpenAICompatEmbeddingBackend(
      'zhipu-coding-cn',
      model,
      'https://open.bigmodel.cn/api/coding/paas/v4',
      apiKey
    );
  }

  async embed(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.endpoint}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (error) {
      throw new Error(`${this.provider} embedding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const response = await fetch(`${this.endpoint}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data.map((item: any) => item.embedding);
    } catch (error) {
      throw new Error(`${this.provider} batch embedding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async similarity(textA: string, textB: string): Promise<number> {
    const [vecA, vecB] = await this.embedBatch([textA, textB]);
    return cosineSimilarity(vecA, vecB);
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
