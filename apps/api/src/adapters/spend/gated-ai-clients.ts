/**
 * [USAGE-ALLOWANCE · Task 3] The GATED provider wrappers. Each wraps a provider client and routes every
 * call through the single AiGate: estimate worst-case → reserve → call → settle actual. They are the
 * ONLY code that invokes a provider client in production; a service never holds a raw provider.
 *
 * When no gate is set (unit tests that build services directly), they pass straight through — the wiring
 * guard asserts production actually sets the gate, so an ungated boot cannot ship.
 */
import type { ModelClient, ModelCompletionRequest, ModelCompletionResponse } from '../../ports/model.js';
import type { Embedder } from '../../ports/embedder.js';
import type { Transcriber, TranscriptionResult } from '../../ports/transcriber.js';
import { currentAiGate } from '../../services/spend/ai-gate.js';
import {
  AI_PRICES,
  anthropicCostUsd,
  embeddingCostUsd,
  transcriptionCostUsd,
  estimateAudioSeconds,
  usdToAed,
} from '../../services/spend/ai-prices.js';

const ANTHROPIC_FALLBACK = AI_PRICES.anthropic['claude-sonnet-5']!;

/** Worst-case AED for an Anthropic call: ALL input chars counted as tokens (a true ceiling — a BPE token
 *  covers ≥1 char) priced at the cache-WRITE rate (the highest input-side rate, so a cold cache-writing
 *  call is still covered), plus max_tokens priced as output. Never below actual on cold, warm, or dense input.
 *  We deliberately use this cheap, provable upper bound rather than Anthropic's token-counting endpoint
 *  (count_tokens — which IS available on the prod Anthropic-API path, MODEL_PROVIDER=anthropic): a
 *  reservation only needs to never UNDER-count, and avoiding a second round-trip per call keeps the
 *  capture path fast. If tighter reservations are ever wanted, count_tokens is the drop-in there. */
export function anthropicEstimateAed(modelId: string, req: ModelCompletionRequest): number {
  const p = AI_PRICES.anthropic[modelId] ?? ANTHROPIC_FALLBACK;
  const inputChars = (req.system?.length ?? 0) + req.messages.reduce((n, m) => n + m.content.length, 0);
  const maxOut = req.maxTokens ?? 0;
  const usd = (inputChars * p.cacheWritePerMTok + maxOut * p.outputPerMTok) / 1_000_000;
  return usdToAed(usd);
}

export class GatedModelClient implements ModelClient {
  constructor(readonly inner: ModelClient, private readonly modelId: string) {}

  async complete(req: ModelCompletionRequest): Promise<ModelCompletionResponse> {
    const gate = currentAiGate();
    if (!gate) return this.inner.complete(req);
    return gate.run({
      userId: req.userId ?? null,
      estimateAed: anthropicEstimateAed(this.modelId, req),
      // The ONLY exempt paid call: erasure re-summarisation (a legal obligation) runs even when paused.
      exemptFromPause: req.spendClass === 'erasure',
      exec: () => this.inner.complete(req),
      actualAedFrom: (res) => usdToAed(anthropicCostUsd(this.modelId, res.usage ?? { inputTokens: 0, outputTokens: 0 })),
    });
  }
}

export class GatedEmbedder implements Embedder {
  constructor(private readonly inner: Embedder) {}
  get dimension(): number {
    return this.inner.dimension;
  }

  async embed(userId: string, text: string): Promise<number[]> {
    const gate = currentAiGate();
    if (!gate) return this.inner.embed(userId, text);
    // The embedder returns only a vector (no usage), so actual == the char-based estimate.
    const estimateAed = usdToAed(embeddingCostUsd(text.length, 0));
    return gate.run({
      userId,
      estimateAed,
      exec: () => this.inner.embed(userId, text),
      actualAedFrom: () => estimateAed,
    });
  }
}

export class GatedTranscriber implements Transcriber {
  constructor(private readonly inner: Transcriber, private readonly modelId: string) {}

  async transcribe(userId: string, audio: Uint8Array): Promise<TranscriptionResult> {
    const gate = currentAiGate();
    if (!gate) return this.inner.transcribe(userId, audio);
    // Estimate from the recording's byte length (a safe upper bound on duration); settle on the exact
    // duration the provider returns (verbose_json), falling back to the estimate if it is absent.
    const estimateAed = usdToAed(transcriptionCostUsd(this.modelId, estimateAudioSeconds(audio.length)));
    return gate.run({
      userId,
      estimateAed,
      exec: () => this.inner.transcribe(userId, audio),
      actualAedFrom: (res) => usdToAed(transcriptionCostUsd(this.modelId, res.durationSeconds ?? estimateAudioSeconds(audio.length))),
    });
  }
}
