import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// [RULING 2 item 5a] The allowance bypass (forceAllowance / forceReserve) may be SET at exactly ONE
// call site — the shared claim-and-extract path that continues an already-claimed chat. This guard
// fails if any other production source sets it, so the bypass can never spread to a path that hasn't
// claimed (and thus hasn't started) a chat.
const SRC = fileURLToPath(new URL('../../', import.meta.url)); // apps/api/src

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const rel = (f: string): string => f.slice(SRC.length);

describe('[RULING 2 item 5a] the allowance bypass has exactly one call site', () => {
  const files = sourceFiles(SRC);

  // [P79-EMERGENCY · owner, 19 Nov] "Remove the allowance exemption for chats that have started": its one call site is
  // gone, so NO production source passes it now. The pin moves from one call site to none, with this note.
  it('no production source passes forceAllowance: true (the started-chat exemption is removed)', () => {
    const hits = files.filter((f) => /forceAllowance:\s*true/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(hits).toEqual([]);
  });

  it('no production source sets forceReserve: true directly (the gate derives it from the request)', () => {
    const hits = files.filter((f) => /forceReserve:\s*true/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(hits).toEqual([]);
  });
});
