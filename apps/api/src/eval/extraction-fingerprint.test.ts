import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importClosure, extractionFingerprint, GATE_ENTRY_FILES } from './extraction-fingerprint.js';

/** [P25-2] The window key's "extraction code" = a hash of EVERY local file the gate's scoring path loads
 *  (the import closure of eval/gate.ts + score.ts + eval-set.ts) — so any change to what the gate scores
 *  starts a fresh window, and a change elsewhere does not. */
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'fp-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c); }
  return dir;
}

describe('[P25-2] extraction fingerprint', () => {
  const base = {
    'eval/gate.ts': "import { a } from '../services/extraction/a.js';\nimport type { T } from '../ports/t.js';\nimport pg from 'pg';\nexport const g = a;",
    'services/extraction/a.ts': "import { b } from './b.js';\nexport const a = b;",
    'services/extraction/b.ts': 'export const b = 1;',
    'ports/t.ts': 'export type T = number;',
    'services/other.ts': 'export const unrelated = 1;',
  };
  it('follows relative imports (type-only too), ignores packages', () => {
    const dir = tree(base);
    expect(importClosure(dir, ['eval/gate.ts'])).toEqual(['eval/gate.ts', 'ports/t.ts', 'services/extraction/a.ts', 'services/extraction/b.ts']);
  });
  it('is stable, changes when a closure file changes, and not when an unrelated file changes', () => {
    const a = extractionFingerprint(tree(base), ['eval/gate.ts']);
    expect(extractionFingerprint(tree(base), ['eval/gate.ts'])).toBe(a);
    expect(extractionFingerprint(tree({ ...base, 'services/extraction/b.ts': 'export const b = 2;' }), ['eval/gate.ts'])).not.toBe(a);
    expect(extractionFingerprint(tree({ ...base, 'services/other.ts': 'export const unrelated = 2;' }), ['eval/gate.ts'])).toBe(a);
  });
  it('on the real tree: the closure covers the certified prompt, the owner check and the scorer', () => {
    const files = importClosure(join(__dirname, '..'), GATE_ENTRY_FILES);
    for (const f of ['eval/gate.ts', 'eval/score.ts', 'eval/eval-set.ts', 'services/extraction/prompt.ts', 'services/extraction/owner-check.ts', 'services/redaction/redact.ts']) expect(files).toContain(f);
    expect(extractionFingerprint(join(__dirname, '..'), GATE_ENTRY_FILES)).toMatch(/^[0-9a-f]{64}$/);
  });
});
