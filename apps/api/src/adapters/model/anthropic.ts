import {
  ModelError,
  type ModelClient,
  type ModelCompletionRequest,
  type ModelCompletionResponse,
} from '../../ports/model.js';

export interface AnthropicModelClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

interface AnthropicResponseBody {
  content?: Array<{ type: string; text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * Build the `system` field. With caching on, it becomes a content-block array
 * whose (single) block carries `cache_control: ephemeral` — the breakpoint that
 * actually turns Anthropic/Bedrock prompt caching ON. Without it, a plain-string
 * system prompt is NEVER cached, no matter how byte-identical it is.
 */
function buildSystem(system: string | undefined, cache: boolean | undefined): unknown {
  if (system === undefined) return undefined;
  if (!cache) return system;
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}

/**
 * HTTP adapter for the Anthropic Messages API (also the shape Bedrock speaks).
 * Every transport/parse failure is converted into a typed {@link ModelError}
 * with a controlled message — callers never see raw undici/errno internals.
 */
export class AnthropicModelClient implements ModelClient {
  constructor(private readonly opts: AnthropicModelClientOptions) {}

  /** The model id this client sends to the API — exposed for routing assertions. */
  get modelId(): string {
    return this.opts.model;
  }

  async complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30_000);

    let response: Response;
    try {
      response = await fetch(`${this.opts.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.opts.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.opts.model,
          max_tokens: request.maxTokens ?? 1024,
          system: buildSystem(request.system, request.cacheSystemPrompt),
          messages: request.messages,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        }),
        signal: controller.signal,
      });
    } catch (cause) {
      // Network error, DNS failure, timeout/abort — all become a typed error.
      throw new ModelError('model request failed', cause);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new ModelError('model request failed', { status: response.status });
    }

    let body: AnthropicResponseBody;
    try {
      body = (await response.json()) as AnthropicResponseBody;
    } catch (cause) {
      throw new ModelError('model request failed', cause);
    }

    const text = body.content?.find((b) => b.type === 'text')?.text ?? '';
    const u = body.usage;
    return {
      text,
      usage: {
        inputTokens: u?.input_tokens ?? 0,
        outputTokens: u?.output_tokens ?? 0,
        // Present only when the provider caches — surfaced so callers/observability
        // can PROVE a cache read happened (cacheReadInputTokens > 0).
        ...(u?.cache_creation_input_tokens !== undefined ? { cacheCreationInputTokens: u.cache_creation_input_tokens } : {}),
        ...(u?.cache_read_input_tokens !== undefined ? { cacheReadInputTokens: u.cache_read_input_tokens } : {}),
      },
      raw: body,
    };
  }
}
