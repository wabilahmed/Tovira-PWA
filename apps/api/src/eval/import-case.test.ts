import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatImportFailure } from './import-case.js';
import type { Extraction } from '../services/extraction/types.js';

// [P58-P4 · owner] When an import fixture breaks a trust rule, the gate prints what the model produced for that record,
// verbatim (the extraction the invariants scored), so a failure can be read without re-running anything. Like P48-2's
// fab cases: reporting, outside the gate surfaces (gate.ts is untouched; index.ts already holds the record).
const record = { summary: 'Omar wants a revised quote.', promises: [{ text: 'Send the revised quote', owner: 'rep', due_date: null, due_raw: 'Thursday', confidence: 'high', source_span: "I'll send the revised quote Thursday", source_message_at: '03/06/2024, 09:41' }], people: [{ name: 'Gulf Distributors', role: 'competitor', reports_to: null, decision_role: 'unknown', notes: null, source_span: 'Gulf Distributors quoted us lower', source_message_at: null }], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null } as unknown as Extraction;

describe('[P58-P4] the record behind an import-fixture failure', () => {
  it('prints the fixture, the reasons, and the whole record as the model produced it, every line tagged [gate]', () => {
    const lines = formatImportFailure('import-easy-omar', ['forbidden entity leaked into the record: "Gulf Distributors"'], record);
    expect(lines[0]).toBe('[gate]   import-easy-omar: the record the model produced (verbatim, as scored) for: forbidden entity leaked into the record: "Gulf Distributors"');
    expect(lines.every((l) => l.startsWith('[gate]     ') || l === lines[0])).toBe(true);
    const json = JSON.parse(lines.slice(1).map((l) => l.slice('[gate]     '.length)).join('\n'));
    expect(json).toEqual(JSON.parse(JSON.stringify(record)));
  });
  it('a record that came back empty says so', () => {
    expect(formatImportFailure('import-easy-omar', ['x'], null)).toEqual(['[gate]   import-easy-omar: the model produced no usable record (starved, timed out or invalid)']);
  });
  it('wired into the gate: printed on a WRONGNESS fail, never gated on', () => {
    const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/if \(r\.wrongness\.length\) for \(const l of formatImportFailure\(f\.id, r\.wrongness, actual\)\) console\.log\(l\);/);
    expect(src).toMatch(/if \(!wrongOk\) for \(const l of formatImportFailure\(f\.id, \['wrongness'\], actual\)\) console\.log\(l\);/);
  });
});
