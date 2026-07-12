/**
 * Port: text embeddings for the "messy pile" (semantic search over notes). Local
 * dev uses a deterministic stub; prod uses Bedrock (Titan/Cohere).
 */
export interface Embedder {
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
}
