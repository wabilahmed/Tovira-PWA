import { describe, it, expect } from 'vitest';
import { BedrockEmbedder, type BedrockInvoker } from './bedrock.js';
import { EmbeddingError } from '../../ports/embedder.js';

function invoker(impl: BedrockInvoker['send']): BedrockInvoker {
  return { send: impl };
}

describe('BedrockEmbedder', () => {
  it('parses the Titan embedding from the response body', async () => {
    const client = invoker(async () => ({ body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1, 0.2, 0.3] })) }));
    const e = new BedrockEmbedder({ region: 'us-east-1', dimension: 3, client });
    expect(await e.embed('hello')).toEqual([0.1, 0.2, 0.3]);
    expect(e.dimension).toBe(3);
  });

  it('wraps a transport failure in a typed EmbeddingError', async () => {
    const client = invoker(async () => { throw new Error('no creds'); });
    const err = await new BedrockEmbedder({ region: 'us-east-1', client }).embed('x').catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddingError);
    expect((err as Error).message).toBe('embedding request failed');
  });

  it('errors when the response has no embedding', async () => {
    const client = invoker(async () => ({ body: new TextEncoder().encode(JSON.stringify({ nope: true })) }));
    await expect(new BedrockEmbedder({ region: 'us-east-1', client }).embed('x')).rejects.toBeInstanceOf(EmbeddingError);
  });
});
