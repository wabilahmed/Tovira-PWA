/**
 * Port: text embeddings for the "messy pile" (semantic search over notes). Local
 * dev uses a deterministic stub; prod uses Bedrock (Titan/Cohere).
 */
export interface Embedder {
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
}

export class EmbeddingError extends Error {
  override name = 'EmbeddingError';
  constructor(message: string, cause?: unknown) {
    super(message);
    if (cause !== undefined) this.cause = cause;
  }
}
