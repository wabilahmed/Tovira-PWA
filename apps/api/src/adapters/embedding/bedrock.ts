import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { EmbeddingError, type Embedder } from '../../ports/embedder.js';

/** Minimal surface we use (so tests can inject a fake without AWS creds). */
export interface BedrockInvoker {
  send(command: InvokeModelCommand): Promise<{ body: Uint8Array }>;
}

export interface BedrockEmbedderOptions {
  region: string;
  modelId?: string;
  dimension?: number;
  client?: BedrockInvoker;
}

/**
 * Amazon Titan Text Embeddings V2 via Bedrock (P6-2). Same Embedder port as the
 * local stub — a config swap, not a rewrite. Transport/parse failures become a
 * typed {@link EmbeddingError}.
 */
export class BedrockEmbedder implements Embedder {
  readonly dimension: number;
  private readonly modelId: string;
  private readonly client: BedrockInvoker;

  constructor(opts: BedrockEmbedderOptions) {
    this.dimension = opts.dimension ?? 1024;
    this.modelId = opts.modelId ?? 'amazon.titan-embed-text-v2:0';
    this.client = opts.client ?? (new BedrockRuntimeClient({ region: opts.region }) as unknown as BedrockInvoker);
  }

  async embed(text: string): Promise<number[]> {
    try {
      const res = await this.client.send(
        new InvokeModelCommand({
          modelId: this.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({ inputText: text, dimensions: this.dimension, normalize: true }),
        }),
      );
      const parsed = JSON.parse(new TextDecoder().decode(res.body)) as { embedding?: number[] };
      if (!Array.isArray(parsed.embedding)) throw new EmbeddingError('embedding response missing vector');
      return parsed.embedding;
    } catch (err) {
      if (err instanceof EmbeddingError) throw err;
      throw new EmbeddingError('embedding request failed', err);
    }
  }
}
