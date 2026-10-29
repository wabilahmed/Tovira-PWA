import type { Extraction } from '../services/extraction/types.js';

/**
 * [P58-P4 · owner] What the model produced for an import fixture that broke a trust rule: the whole record, verbatim
 * (the extraction the invariants scored), one JSON line per gate log line. The gate kept only a one-line reason, so a
 * failure (P57: "Gulf Distributors" leaked) could not be read without re-running. Outside the gate surfaces on purpose
 * (eval/extraction-fingerprint.ts), like P48-2's fab cases: reporting, not scoring.
 */
export function formatImportFailure(fixtureId: string, reasons: string[], actual: Extraction | null): string[] {
  if (!actual) return [`[gate]   ${fixtureId}: the model produced no usable record (starved, timed out or invalid)`];
  return [
    `[gate]   ${fixtureId}: the record the model produced (verbatim, as scored) for: ${reasons.join('; ')}`,
    ...JSON.stringify(actual, null, 2).split('\n').map((l) => `[gate]     ${l}`),
  ];
}
