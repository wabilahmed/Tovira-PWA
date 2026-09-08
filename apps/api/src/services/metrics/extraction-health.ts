/**
 * [EXTRACT-STOPREASON] Observability for the extraction failure that reached a blind test instead of
 * a log: a reasoning model spending its whole `max_tokens` budget on thinking and emitting NO text,
 * so extraction silently produced nothing. Counted here and surfaced on /health so a recurrence
 * (e.g. a future model change, or an input beyond the derived budget) is loud, not silent.
 */
export class ExtractionHealthRegistry {
  private starved = 0;

  /** A model call returned no text answer (max_tokens hit / thinking-only). */
  recordStarvedOutput(): void {
    this.starved += 1;
  }

  snapshot(): { starvedOutputs: number } {
    return { starvedOutputs: this.starved };
  }
}
