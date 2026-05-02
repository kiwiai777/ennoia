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

export class OllamaEmbeddingBackend implements EmbeddingBackend {
  readonly provider = 'ollama';

  constructor(
    readonly model: string,
    private endpoint: string
  ) {}

  async embed(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.endpoint}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.embeddings[0];
    } catch (error) {
      throw new Error(`Ollama embedding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const CHUNK_SIZE = 32;  // 每��最多 32 个，���免 HTTP 400
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
      const chunk = texts.slice(i, i + CHUNK_SIZE);

      try {
        const response = await fetch(`${this.endpoint}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            input: chunk,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();

        // 检��并过���包含 NaN 的 embedding
        for (let j = 0; j < data.embeddings.length; j++) {
          const embedding = data.embeddings[j];
          const hasNaN = embedding.some((v: number) => isNaN(v) || !isFinite(v));

          if (hasNaN) {
            console.error(`    ⚠️  Skipping text with NaN embedding: "${chunk[j].substring(0, 50)}..."`);
            // 用零��量替代��这样���似度会很��，不��误匹���）
            results.push(new Array(embedding.length).fill(0));
          } else {
            results.push(embedding);
          }
        }

        // 进度��示（���次多时有��）
        if (texts.length > CHUNK_SIZE) {
          console.error(`    Embedding: ${Math.min(i + CHUNK_SIZE, texts.length)}/${texts.length}...`);
        }
      } catch (error) {
        throw new Error(`Ollama batch embedding failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return results;
  }

  async similarity(textA: string, textB: string): Promise<number> {
    const [vecA, vecB] = await this.embedBatch([textA, textB]);
    return cosineSimilarity(vecA, vecB);
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

      if (!models.includes(this.model)) {
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
