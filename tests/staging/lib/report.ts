/**
 * Run reporter. Every flow/assertion outcome is appended as a JSON line to a shared
 * results file (surviving vitest's per-file worker isolation) AND printed live. Task C
 * reads the results file to assemble STAGING-TEST-REPORT.md. Results are keyed by the
 * flow id so the report can render the per-flow coverage table.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Outcome = 'PASS' | 'FAIL' | 'PARTIAL' | 'UNREACHABLE' | 'HUMAN-ONLY';

export interface FlowResult {
  ts: string;
  part: 'A' | 'B';
  /** Flow id (e.g. "FLOW 2", "P5-2", "EXTREME-3") or a suite tag. */
  flow: string;
  name: string;
  outcome: Outcome;
  detail?: string;
  /** Captured request/response for a failure. */
  exchange?: string;
  /** Stop-the-line marker: isolation breach or a refusal-set fabrication. */
  stopTheLine?: boolean;
  /** Free-form numbers (tokens, cost, timings) for Part B. */
  metrics?: Record<string, number | string>;
}

export const RESULTS_FILE = process.env.STAGING_RESULTS_FILE || 'tests/staging/.results/latest.jsonl';

export class Reporter {
  constructor(private readonly file: string = RESULTS_FILE) {
    mkdirSync(dirname(this.file), { recursive: true });
  }

  record(r: Omit<FlowResult, 'ts'>): void {
    const line: FlowResult = { ts: new Date().toISOString(), ...r };
    appendFileSync(this.file, `${JSON.stringify(line)}\n`);
    const tag = r.stopTheLine ? '⛔ STOP-THE-LINE' : r.outcome;
     
    console.log(`  [${tag}] ${r.flow} — ${r.name}${r.detail ? ` · ${r.detail}` : ''}`);
  }

  pass(part: FlowResult['part'], flow: string, name: string, detail?: string): void {
    this.record({ part, flow, name, outcome: 'PASS', detail });
  }
  fail(part: FlowResult['part'], flow: string, name: string, detail: string, exchange?: string, stopTheLine = false): void {
    this.record({ part, flow, name, outcome: 'FAIL', detail, exchange, stopTheLine });
  }
  unreachable(part: FlowResult['part'], flow: string, name: string, detail: string): void {
    this.record({ part, flow, name, outcome: 'UNREACHABLE', detail });
  }
  humanOnly(part: FlowResult['part'], flow: string, name: string, detail: string): void {
    this.record({ part, flow, name, outcome: 'HUMAN-ONLY', detail });
  }
}
