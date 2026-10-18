import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * [P21-R1 / FEAT-06] Static guard (runs on every laptop `npm test`, no database): every NoteSource the app
 * can write must be allowed by the LATEST notes_source_check in the migrations. Ask capture wrote
 * 'ask_conversation', which the constraint rejected — the in-memory store has no CHECK, so the whole suite
 * passed while every production capture failed.
 */
const MIGRATIONS = fileURLToPath(new URL('../../migrations', import.meta.url));
const PORT = fileURLToPath(new URL('../ports/note-repository.ts', import.meta.url));

function allowedSources(): string[] {
  let last: string[] | null = null;
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8').replace(/--.*$/gm, ''); // comments never run
    const re = /notes_source_check\s+CHECK\s*\(\s*source\s+IN\s*\(([^)]*)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) last = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
  }
  if (!last) throw new Error('no notes_source_check found in migrations');
  return last;
}

function noteSources(): string[] {
  const m = /export type NoteSource\s*=\s*([^;]+);/.exec(readFileSync(PORT, 'utf8'));
  if (!m) throw new Error('NoteSource type not found');
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

describe('[P21-R1] notes_source_check allows every NoteSource', () => {
  it('each NoteSource value is in the latest constraint', () => {
    const allowed = allowedSources();
    for (const s of noteSources()) expect(allowed, `notes_source_check must allow '${s}'`).toContain(s);
  });
});
