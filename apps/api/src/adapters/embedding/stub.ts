import { createHash } from 'node:crypto';
import type { Embedder } from '../../ports/embedder.js';

/**
 * Deterministic local embedder: derives a fixed-dimension vector from a hash of
 * the text so semantic-search plumbing (pgvector storage) works offline. Not a
 * real semantic model — swapped for Bedrock in prod.
 */
export class StubEmbedder implements Embedder {
  readonly dimension: number;
  constructor(dimension = 1024) {
    this.dimension = dimension;
  }

  async embed(text: string): Promise<number[]> {
    const vec = new Array<number>(this.dimension);
    let seed = createHash('sha256').update(text).digest();
    for (let i = 0; i < this.dimension; i++) {
      if (i % seed.length === 0 && i > 0) {
        seed = createHash('sha256').update(seed).digest();
      }
      // Map a byte to [-1, 1].
      vec[i] = (seed[i % seed.length]! / 127.5) - 1;
    }
    return vec;
  }
}
