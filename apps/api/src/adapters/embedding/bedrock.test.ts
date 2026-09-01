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

  it('wraps a transport failure in a typed EmbeddingError, surfacing the AWS cause', async () => {
    const client = invoker(async () => { throw new Error('no creds'); });
    const err = await new BedrockEmbedder({ region: 'us-east-1', client }).embed('x').catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddingError);
    // Message keeps the base + surfaces the underlying AWS error (name + message) so
    // a Bedrock failure is diagnosable from logs; the original error is kept as cause.
    expect((err as Error).message).toContain('embedding request failed');
    expect((err as Error).message).toContain('no creds');
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(Error);
  });

  it('errors when the response has no embedding', async () => {
    const client = invoker(async () => ({ body: new TextEncoder().encode(JSON.stringify({ nope: true })) }));
    await expect(new BedrockEmbedder({ region: 'us-east-1', client }).embed('x')).rejects.toBeInstanceOf(EmbeddingError);
  });
});
