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
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * HTTP adapter for the Anthropic Messages API (also the shape Bedrock speaks).
 * Every transport/parse failure is converted into a typed {@link ModelError}
 * with a controlled message — callers never see raw undici/errno internals.
 */
export class AnthropicModelClient implements ModelClient {
  constructor(private readonly opts: AnthropicModelClientOptions) {}

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
          system: request.system,
          messages: request.messages,
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
    return {
      text,
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      },
      raw: body,
    };
  }
}
