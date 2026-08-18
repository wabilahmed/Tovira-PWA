/**
 * Port: the AI model. Business logic depends on THIS interface, never on a
 * concrete SDK. Local dev uses a stub; prod routes through Bedrock — a config
 * swap, not a rewrite.
 */

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ModelCompletionRequest {
  system?: string;
  messages: ModelMessage[];
  maxTokens?: number;
  /** Sampling temperature. The gated extraction engine pins this to 0 for
   *  determinism (a gate needs reproducible output); omitted → provider default. */
  temperature?: number;
  /** Mark the system prompt as a prompt-cache breakpoint (Anthropic/Bedrock
   *  `cache_control: ephemeral`). Set for a large, byte-identical prefix — the
   *  extraction engine — so repeat calls read the cache instead of re-billing the
   *  whole prefix. No-op for providers/stubs that don't cache. */
  cacheSystemPrompt?: boolean;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to the prompt cache on this call (first call after a change).
   *  Present only when the provider reports it (Anthropic/Bedrock). */
  cacheCreationInputTokens?: number;
  /** Tokens READ from the prompt cache — the win. >0 proves caching is working. */
  cacheReadInputTokens?: number;
}

export interface ModelCompletionResponse {
  text: string;
  usage?: ModelUsage;
  raw?: unknown;
}

export interface ModelClient {
  complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse>;
}

/** Typed failure for all model transports — never leak vendor internals upward. */
export class ModelError extends Error {
  override name = 'ModelError';
  constructor(message: string, cause?: unknown) {
    super(message);
    if (cause !== undefined) this.cause = cause;
  }
}
