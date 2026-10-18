import {
  ModelError,
  type CacheTtl,
  type ModelClient,
  type ModelCompletionRequest,
  type ModelCompletionResponse,
} from '../../ports/model.js';
import { modelCapabilities, type Effort, type ThinkingMode } from './capabilities.js';

/** Anthropic beta flag required to use the 1-hour prompt-cache TTL. */
const EXTENDED_CACHE_TTL_BETA = 'extended-cache-ttl-2025-04-11';

export interface AnthropicModelClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  /** [P23-A2] Sent as output_config.effort to models that take it explicitly (required for 5.5). */
  effort?: Effort;
  /** [P23-A2] 'disabled' is sent only where the model accepts it (Haiku 5.5 at ≤ high effort). */
  thinking?: ThinkingMode;
}

interface AnthropicResponseBody {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
    output_tokens_details?: { thinking_tokens?: number };
  };
}

/**
 * Build the `system` field. With caching on, it becomes a content-block array
 * whose (single) block carries `cache_control: ephemeral` — the breakpoint that
 * actually turns Anthropic/Bedrock prompt caching ON. Without it, a plain-string
 * system prompt is NEVER cached, no matter how byte-identical it is.
 *
 * ttl '1h' adds `ttl: '1h'` (the extended tier — survives longer gaps at a higher
 * write premium); '5m'/omitted is the default ephemeral lifetime.
 */
function buildSystem(system: string | undefined, cache: boolean | undefined, ttl: CacheTtl | undefined): unknown {
  if (system === undefined) return undefined;
  if (!cache) return system;
  const cache_control = ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
  return [{ type: 'text', text: system, cache_control }];
}

/**
 * HTTP adapter for the Anthropic Messages API (also the shape Bedrock speaks).
 * Every transport/parse failure is converted into a typed {@link ModelError}
 * with a controlled message — callers never see raw undici/errno internals.
 */
export class AnthropicModelClient implements ModelClient {
  constructor(private readonly opts: AnthropicModelClientOptions) {
    // [P23-A2] A 5.5 model at the API's default effort would think (and bill) far more than measured.
    if (modelCapabilities(opts.model).explicitEffort && !opts.effort) {
      throw new Error(`model ${opts.model} needs an explicit effort (EFFORT_EXTRACT / EFFORT_AUX)`);
    }
  }

  /** [P23-A2] The model-specific request fields: effort, thinking and (only where accepted) temperature. */
  private modelFields(request: ModelCompletionRequest): Record<string, unknown> {
    const caps = modelCapabilities(this.opts.model);
    const out: Record<string, unknown> = {};
    if (caps.explicitEffort && this.opts.effort) out.output_config = { effort: this.opts.effort };
    const effortAllowsDisable = this.opts.effort !== 'xhigh' && this.opts.effort !== 'max';
    if (this.opts.thinking === 'disabled' && caps.canDisableThinking && effortAllowsDisable) out.thinking = { type: 'disabled' };
    if (caps.sampling && request.temperature !== undefined) out.temperature = request.temperature;
    return out;
  }

  /** The model id this client sends to the API — exposed for routing assertions. */
  get modelId(): string {
    return this.opts.model;
  }

  async complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30_000);

    // The 1-hour cache tier is gated behind a beta flag; the 5-minute default is not.
    const wantsExtendedTtl = request.cacheSystemPrompt === true && request.cacheTtl === '1h';

    let response: Response;
    try {
      response = await fetch(`${this.opts.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.opts.apiKey,
          'anthropic-version': '2023-06-01',
          ...(wantsExtendedTtl ? { 'anthropic-beta': EXTENDED_CACHE_TTL_BETA } : {}),
        },
        body: JSON.stringify({
          model: this.opts.model,
          max_tokens: request.maxTokens ?? 1024,
          system: buildSystem(request.system, request.cacheSystemPrompt, request.cacheTtl),
          messages: request.messages,
          ...this.modelFields(request),
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
      stopReason: body.stop_reason,
      usage: {
        inputTokens: u?.input_tokens ?? 0,
        outputTokens: u?.output_tokens ?? 0,
        // Present only when the provider caches — surfaced so callers/observability
        // can PROVE a cache read happened (cacheReadInputTokens > 0).
        ...(u?.cache_creation_input_tokens !== undefined ? { cacheCreationInputTokens: u.cache_creation_input_tokens } : {}),
        ...(u?.cache_creation?.ephemeral_5m_input_tokens !== undefined ? { cacheCreation5mInputTokens: u.cache_creation.ephemeral_5m_input_tokens } : {}),
        ...(u?.cache_read_input_tokens !== undefined ? { cacheReadInputTokens: u.cache_read_input_tokens } : {}),
        ...(u?.output_tokens_details?.thinking_tokens !== undefined ? { thinkingTokens: u.output_tokens_details.thinking_tokens } : {}),
      },
      raw: body,
    };
  }
}
