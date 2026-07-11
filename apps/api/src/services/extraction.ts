import type { ModelClient } from '../ports/model.js';

/**
 * Skeleton extraction flow (fleshed out in P1-6). It exists here to prove the
 * business logic depends ONLY on the ModelClient port: swap the implementation
 * via config and this still runs unchanged.
 */

export interface ExtractionInput {
  transcript: string;
  /** Today's date, passed in the VARIABLE part of the prompt (never cached). */
  today: string;
}

export interface ExtractionResult {
  raw: string;
  data: unknown;
}

export async function extractFacts(model: ModelClient, input: ExtractionInput): Promise<ExtractionResult> {
  const response = await model.complete({
    system: 'Extract structured facts from the note and return JSON only.',
    messages: [{ role: 'user', content: `today=${input.today}\n\n${input.transcript}` }],
  });
  return { raw: response.text, data: JSON.parse(response.text) };
}
