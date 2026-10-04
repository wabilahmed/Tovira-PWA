import { describe, it, expect } from 'vitest';
import { parseBatch, BULK_MAX_FILES, type BulkClient } from './bulk-parse.js';

// [BULK-IMPORT · Task 2] The deterministic multi-file parse + rep-by-elimination + client matching.
// Pure, no network, no model. Android bare + iOS bracketed line shapes.
const A = (ts: string, sender: string, body: string) => `${ts} - ${sender}: ${body}`; // Android bare
const I = (ts: string, sender: string, body: string) => `[${ts}] ${sender}: ${body}`; // iOS bracketed
/** An Android one-to-one chat between two named senders. */
function chat(rep: string, other: string, lines: Array<[string, string]> = [['hi', 'hello']]): string {
  const out: string[] = [];
  let i = 0;
  for (const [r, o] of lines) {
    out.push(A(`13/07/2019, ${1 + i}:00 am`, rep, r));
    out.push(A(`13/07/2019, ${1 + i}:01 am`, other, o));
    i += 1;
  }
  return out.join('\n');
}
const file = (name: string, content: string) => ({ name, content });
const NO_CLIENTS: BulkClient[] = [];

describe('[BULK-IMPORT] rep by elimination', () => {
  it('identifies the rep as the sender common to every one-to-one file; each other sender is that file\'s counterpart', () => {
    const r = parseBatch([
      file('a.txt', chat('Wabil', 'Bubu DXB')),
      file('b.txt', chat('Wabil', 'Sara Lee')),
      file('c.txt', chat('Wabil', 'Omar')),
    ], NO_CLIENTS);
    expect(r.repName).toBe('Wabil');
    expect(r.needsRepId).toBe(false);
    expect(r.rows.map((x) => x.counterpart)).toEqual(['Bubu DXB', 'Sara Lee', 'Omar']);
    expect(r.rows.every((x) => x.state === 'new')).toBe(true);
    expect(r.rows[0]!.platform).toBe('android');
  });

  it('one file with a stored rep name that matches a sender resolves without asking', () => {
    const r = parseBatch([file('a.txt', chat('Wabil', 'Khalid'))], NO_CLIENTS, 'Wabil');
    expect(r.repName).toBe('Wabil');
    expect(r.needsRepId).toBe(false);
    expect(r.rows[0]!.counterpart).toBe('Khalid');
  });

  it('one file with NO rep info cannot eliminate — asks "which of these is you?" once', () => {
    const r = parseBatch([file('a.txt', chat('Wabil', 'Khalid'))], NO_CLIENTS);
    expect(r.needsRepId).toBe(true);
    expect(r.rows[0]!.state).toBe('needs_rep_id');
    expect(r.rows[0]!.participants).toEqual(['Wabil', 'Khalid']);
  });
});

describe('[BULK-IMPORT] edge cases', () => {
  it('detects a duplicate (two files sharing BOTH senders) and shows it once', () => {
    const r = parseBatch([
      file('again.txt', chat('Wabil', 'Khalid', [['hi', 'yo']])),
      file('orig.txt', chat('Wabil', 'Khalid', [['hi', 'yo'], ['more', 'sure']])),
      file('b.txt', chat('Wabil', 'Sara')),
    ], NO_CLIENTS);
    const dups = r.rows.filter((x) => x.state === 'duplicate');
    expect(dups).toHaveLength(1);
    expect(dups[0]!.duplicateOfFileName).toBeTruthy();
    // Only ONE of the Khalid pair is a real importable row.
    expect(r.rows.filter((x) => x.counterpart === 'Khalid' && x.state !== 'duplicate')).toHaveLength(1);
  });

  it('a chat with more than two senders is a group (skipped by default), with participants listed', () => {
    const group = [
      A('13/07/2019, 1:00 am', 'Wabil', 'hi all'),
      A('13/07/2019, 1:01 am', 'Khalid', 'hey'),
      A('13/07/2019, 1:02 am', 'Sara', 'salaam'),
    ].join('\n');
    const r = parseBatch([file('g.txt', group), file('b.txt', chat('Wabil', 'Omar'))], NO_CLIENTS);
    const g = r.rows.find((x) => x.fileName === 'g.txt')!;
    expect(g.state).toBe('group');
    expect(new Set(g.participants)).toEqual(new Set(['Wabil', 'Khalid', 'Sara']));
  });

  it('ignores WhatsApp system lines — they are not senders', () => {
    const withSystem = [
      '13/07/2019, 12:59 am - Messages and calls are end-to-end encrypted.',
      A('13/07/2019, 1:00 am', 'Wabil', 'hi'),
      A('13/07/2019, 1:01 am', 'Khalid', 'hello'),
    ].join('\n');
    const r = parseBatch([file('a.txt', withSystem)], NO_CLIENTS, 'Wabil');
    expect(r.rows[0]!.state).not.toBe('group'); // only 2 real senders
    expect(r.rows[0]!.counterpart).toBe('Khalid');
  });

  it('the in-chat sender wins over the file name', () => {
    const r = parseBatch([file('WhatsApp Chat with Omar.txt', chat('Wabil', 'Khalid'))], NO_CLIENTS, 'Wabil');
    expect(r.rows[0]!.counterpart).toBe('Khalid'); // not "Omar" from the filename
  });

  it('matches Arabic / mixed-script names on a normalised form but displays the original', () => {
    const clients: BulkClient[] = [{ id: 'c1', name: 'خالد المرينا' }];
    const r = parseBatch([file('a.txt', chat('Wabil', 'خالد المرينا'))], clients, 'Wabil');
    expect(r.rows[0]!.state).toBe('possible_match');
    expect(r.rows[0]!.matchClientId).toBe('c1');
    expect(r.rows[0]!.counterpart).toBe('خالد المرينا'); // original preserved
  });

  it('unparseable file is flagged, never crashes the batch', () => {
    const r = parseBatch([file('junk.txt', 'this is not a whatsapp export at all'), file('b.txt', chat('Wabil', 'Omar'))], NO_CLIENTS, 'Wabil');
    expect(r.rows.find((x) => x.fileName === 'junk.txt')!.state).toBe('unparseable');
    expect(r.rows.find((x) => x.fileName === 'b.txt')!.counterpart).toBe('Omar'); // the rest still parse
  });
});

describe('[BULK-IMPORT] unsaved numbers (D5)', () => {
  it('finds a self-introduction and SUGGESTS the name (never applies it silently)', () => {
    const c = [
      A('13/07/2019, 1:00 am', 'Wabil', 'hello'),
      A('13/07/2019, 1:01 am', '+971 50 123 4567', "Hi, I'm Khalid from Marina Heights"),
    ].join('\n');
    const r = parseBatch([file('a.txt', c)], NO_CLIENTS, 'Wabil');
    expect(r.rows[0]!.state).toBe('unsaved_intro');
    expect(r.rows[0]!.suggestedName).toBe('Khalid');
    expect(r.rows[0]!.counterpart).toContain('+971'); // still the number until confirmed
  });

  it('a bare number EXACTLY matching an existing client\'s phone auto-attaches across formats (item 4)', () => {
    const clients: BulkClient[] = [{ id: 'c1', name: 'Khalid', phone: '+971501234567' }];
    const c = [
      A('13/07/2019, 1:00 am', 'Wabil', 'hello'),
      A('13/07/2019, 1:01 am', '050 123 4567', "Hi, I'm Khalid"), // local format + an intro
    ].join('\n');
    const r = parseBatch([file('a.txt', c)], clients, 'Wabil');
    expect(r.rows[0]!.state).toBe('existing'); // phone match auto-attaches (no question), over the intro guess
    expect(r.rows[0]!.matchKind).toBe('phone');
    expect(r.rows[0]!.matchClientId).toBe('c1');
  });

  it('no introduction → asks who it is, keeping the number', () => {
    const c = [
      A('13/07/2019, 1:00 am', 'Wabil', 'hello'),
      A('13/07/2019, 1:01 am', '+971501234567', 'ok'),
    ].join('\n');
    const r = parseBatch([file('a.txt', c)], NO_CLIENTS, 'Wabil');
    expect(r.rows[0]!.state).toBe('unsaved_no_intro');
    expect(r.rows[0]!.suggestedName).toBeUndefined();
  });
});

describe('[BULK-IMPORT] matching against existing clients never merges (D3)', () => {
  it('an EXACT name match is a possible_match, not an auto-merge', () => {
    const clients: BulkClient[] = [{ id: 'c1', name: 'Ahmed' }];
    const r = parseBatch([file('a.txt', chat('Wabil', 'Ahmed'))], clients, 'Wabil');
    expect(r.rows[0]!.state).toBe('possible_match'); // NOT silently merged
    expect(r.rows[0]!.matchClientId).toBe('c1');
    expect(r.rows[0]!.matchClientName).toBe('Ahmed');
  });

  it('a clear new name with no match is a new client', () => {
    const r = parseBatch([file('a.txt', chat('Wabil', 'Layla'))], [{ id: 'c1', name: 'Ahmed' }], 'Wabil');
    expect(r.rows[0]!.state).toBe('new');
  });

  it('iOS bracketed format is detected as ios', () => {
    const ios = [I('2026-03-15, 14:22:01', 'Wabil', 'hi'), I('2026-03-15, 14:25:00', 'Omar', 'hello')].join('\n');
    const r = parseBatch([file('a.txt', ios)], NO_CLIENTS, 'Wabil');
    expect(r.rows[0]!.platform).toBe('ios');
  });
});

describe('[BULK-IMPORT] the 20-file cap (D7)', () => {
  it('BULK_MAX_FILES is 20', () => {
    expect(BULK_MAX_FILES).toBe(20);
  });
});
