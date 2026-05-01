export interface LLMExtractionRequest {
  content: string;
  hint?: 'user-profile' | 'plain' | 'agent-def' | string;
}

export interface LLMExtractionCandidate {
  kind: 'preference' | 'goal' | 'constraint' | 'skill' | 'project';
  content: string;
}

export interface LLMBackend {
  readonly provider: string;
  readonly model: string;
  extract(req: LLMExtractionRequest): Promise<LLMExtractionCandidate[]>;
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
}

export interface EmbeddingBackend {
  readonly provider: string;
  readonly model: string;
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: string[]): Promise<number[][]>;
  similarity(textA: string, textB: string): Promise<number>;
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
}
