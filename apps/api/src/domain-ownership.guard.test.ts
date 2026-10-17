import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * [P22-2] We do NOT own the .com domain of our name — it is someone else's live site. Our only domain is
 * the .io one. Any reference to the .com in the repo is a link, sender, or fixture pointing at a stranger.
 * This guard scans every TRACKED file outside docs/ (docs/ is owner-edited and listed in the report
 * instead) and fails the build on a single hit. The pattern is assembled so this file doesn't match itself.
 */
const FORBIDDEN = new RegExp(['tovira', 'com'].join('\\.'), 'i');

describe('[P22-2] no reference to a domain we do not own', () => {
  it('no tracked file outside docs/ mentions it', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter((f) => f && !f.startsWith('docs/'));
    const hits: string[] = [];
    for (const f of files) {
      let text: string;
      try { text = readFileSync(f, 'utf8'); } catch { continue; } // deleted-in-worktree / unreadable
      text.split('\n').forEach((line, i) => { if (FORBIDDEN.test(line)) hits.push(`${f}:${i + 1}`); });
    }
    expect(hits, `references to a domain we don't own:\n${hits.join('\n')}`).toEqual([]);
  });
});
