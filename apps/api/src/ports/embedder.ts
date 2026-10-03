/**
 * Port: text embeddings for the "messy pile" (semantic search over notes). Local
 * dev uses a deterministic stub; prod uses Bedrock (Titan/Cohere).
 */
export interface Embedder {
  readonly dimension: number;
  /** [USAGE-ALLOWANCE] `userId` attributes the embedding's (estimated) cost to the rep's allowance via
   *  the gate. It is always in scope at every call site (no ownerless embeddings). */
  embed(userId: string, text: string): Promise<number[]>;
}

export class EmbeddingError extends Error {
  override name = 'EmbeddingError';
  constructor(message: string, cause?: unknown) {
    super(message);
    if (cause !== undefined) this.cause = cause;
  }
}
