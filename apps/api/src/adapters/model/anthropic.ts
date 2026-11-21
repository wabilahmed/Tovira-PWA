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

export interface AnthropicResponseBody {
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

  /** [P81-2] The request headers. Shared with the batch client, so a batched request is sent exactly as a live one. */
  headers(request: Pick<ModelCompletionRequest, 'cacheSystemPrompt' | 'cacheTtl'>): Record<string, string> {
    // The 1-hour cache tier is gated behind a beta flag; the 5-minute default is not.
    const wantsExtendedTtl = request.cacheSystemPrompt === true && request.cacheTtl === '1h';
    return {
      'content-type': 'application/json',
      'x-api-key': this.opts.apiKey,
      'anthropic-version': '2023-06-01',
      ...(wantsExtendedTtl ? { 'anthropic-beta': EXTENDED_CACHE_TTL_BETA } : {}),
    };
  }

  /** [P81-2] The request body (the Messages API params). Shared with the batch client (byte-identical params). */
  params(request: ModelCompletionRequest): Record<string, unknown> {
    return {
      model: this.opts.model,
      max_tokens: request.maxTokens ?? 1024,
      system: buildSystem(request.system, request.cacheSystemPrompt, request.cacheTtl),
      messages: request.messages,
      ...this.modelFields(request),
    };
  }

  /** The API base URL (the batch client posts to /v1/messages/batches on it). */
  get baseUrl(): string {
    return this.opts.baseUrl;
  }

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
        headers: this.headers(request),
        body: JSON.stringify(this.params(request)),
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

    return parseAnthropicBody(body);
  }
}

/** [P81-2] A Messages API response body → the port's response (shared by the live and the batch client). */
export function parseAnthropicBody(body: AnthropicResponseBody): ModelCompletionResponse {
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

/**
 * [P81-2 · owner, 21 Nov] The Message Batches API (half price) for bulk and multi-file imports. A ModelClient, so the
 * extraction code is unchanged: every request made while a batch is gathering (gatherMs) goes into ONE batch, sent with
 * exactly the headers and params the live client sends (AnthropicModelClient.headers / .params); each caller is answered
 * from its own result, marked `batchDiscount` so the spend gate and the ledger record it at the batch price.
 *
 * An import always finishes: an item the batch errors, cancels or expires, a submit that fails, or a batch still running
 * at maxWaitMs (it is then cancelled, so its unstarted items are not billed) is read live by the wrapped client instead.
 * Results and polling are never logged with content: only the batch id and counts.
 *
 * Measured (owner's real chat, 19 Nov): 10 pieces in one batch ended in 165 s; AED 1.56 vs 3.40 live.
 */
export interface BatchClientOptions {
  fetchImpl?: typeof fetch;
  /** How long requests are gathered into one batch after the first arrives. */
  gatherMs?: number;
  pollMs?: number;
  /** After this, a running batch is cancelled and its unfinished items are read live (keeps under the claim timeout). */
  maxWaitMs?: number;
  /** The API allows 100,000 per batch; a smaller cap keeps one batch's payload modest. */
  maxPerBatch?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Pending { request: ModelCompletionRequest; resolve: (r: ModelCompletionResponse) => void; reject: (e: unknown) => void }
type BatchResult = { type: string; message?: AnthropicResponseBody };

export class AnthropicBatchClient implements ModelClient {
  private gathering: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private readonly o: Required<BatchClientOptions>;

  constructor(private readonly live: AnthropicModelClient, opts: BatchClientOptions = {}) {
    this.o = {
      fetchImpl: opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a)),
      gatherMs: opts.gatherMs ?? 3_000,
      pollMs: opts.pollMs ?? 20_000,
      maxWaitMs: opts.maxWaitMs ?? 6 * 60_000,
      maxPerBatch: opts.maxPerBatch ?? 2_000,
      now: opts.now ?? (() => Date.now()),
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse> {
    return new Promise((resolve, reject) => {
      this.gathering.push({ request, resolve, reject });
      if (this.gathering.length >= this.o.maxPerBatch) { this.flushNow(); return; }
      if (!this.timer) this.timer = setTimeout(() => this.flushNow(), this.o.gatherMs);
    });
  }

  private flushNow(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    while (this.gathering.length > 0) {
      const group = this.gathering.splice(0, this.o.maxPerBatch);
      void this.runBatch(group);
    }
  }

  private async runBatch(group: Pending[]): Promise<void> {
    const ids = group.map(() => `r${++this.seq}`);
    const results = new Map<string, BatchResult>();
    try {
      const headers = this.live.headers(group.some((p) => p.request.cacheSystemPrompt && p.request.cacheTtl === '1h') ? { cacheSystemPrompt: true, cacheTtl: '1h' } : {});
      const base = this.live.baseUrl;
      const sub = await this.o.fetchImpl(`${base}/v1/messages/batches`, {
        method: 'POST', headers,
        body: JSON.stringify({ requests: group.map((p, i) => ({ custom_id: ids[i], params: this.live.params(p.request) })) }),
      });
      if (!sub.ok) throw new Error(`batch submit ${sub.status}`);
      const batch = (await sub.json()) as { id: string };
      const start = this.o.now();
      let st: { ended_at?: string | null; results_url?: string | null } = {};
      let cancelled = false;
      for (;;) {
        await this.o.sleep(this.o.pollMs);
        st = (await (await this.o.fetchImpl(`${base}/v1/messages/batches/${batch.id}`, { headers })).json()) as typeof st;
        if (st.ended_at) break; // the API sets ended_at (and results_url) once every item has finished
        if (!cancelled && this.o.now() - start > this.o.maxWaitMs) {
          cancelled = true; // unstarted items are not billed; what finished is still returned
          await this.o.fetchImpl(`${base}/v1/messages/batches/${batch.id}/cancel`, { method: 'POST', headers });
          console.warn(`[batch] ${batch.id}: still running after ${Math.round(this.o.maxWaitMs / 1000)}s; cancelled, unfinished items read live`);
        }
        if (cancelled && this.o.now() - start > this.o.maxWaitMs * 2) throw new Error('batch did not end after cancel');
      }
      if (st.results_url) {
        const text = await (await this.o.fetchImpl(st.results_url, { headers })).text();
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          const r = JSON.parse(line) as { custom_id: string; result: BatchResult };
          results.set(r.custom_id, r.result);
        }
      }
      const ok = [...results.values()].filter((r) => r.type === 'succeeded').length;
      console.info(`[batch] ${batch.id}: ${group.length} request(s), ${ok} answered by the batch, ${group.length - ok} read live`);
    } catch (err) {
      console.warn(`[batch] ${group.length} request(s) read live: ${err instanceof Error ? err.message : 'batch failed'}`);
    }
    await Promise.all(group.map(async (p, i) => {
      const r = results.get(ids[i]!);
      if (r?.type === 'succeeded' && r.message) {
        const parsed = parseAnthropicBody(r.message);
        p.resolve({ ...parsed, usage: { ...(parsed.usage ?? { inputTokens: 0, outputTokens: 0 }), batchDiscount: true } });
        return;
      }
      try { p.resolve(await this.live.complete(p.request)); } catch (e) { p.reject(e instanceof ModelError ? e : new ModelError('model request failed', e)); }
    }));
  }
}
