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
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
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
