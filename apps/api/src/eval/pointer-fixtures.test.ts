/**
 * [POINTERS · Task 4] Proves the fixture SCORER catches each planted signal — a good model output passes,
 * a bad one fails — without calling the real model. The gate (npm run gate) runs the fixtures against the
 * model; here we prove the judge, so a green gate means something.
 */
import { describe, it, expect } from 'vitest';
import { POINTER_FIXTURES, scorePointerFixture, isGenericPointer, type PointerFixture } from './pointer-fixtures.js';
import type { Pointer } from '../services/extraction/types.js';

const RETRO_DISCLOSURE = 'This is our best reading of what happened, based on your messages. It may not be accurate.';
const fx = (id: string): PointerFixture => POINTER_FIXTURES.find((f) => f.id === id)!;

describe('[POINTERS] all 7 planted-signal fixtures are present', () => {
  it('has exactly the seven fixtures the batch names', () => {
    expect(POINTER_FIXTURES.map((f) => f.id).sort()).toEqual([
      'PF1-reacts-badly', 'PF2-preempt-pleased', 'PF3-thin', 'PF4-sensitive',
      'PF5-lost-confirmed', 'PF6-going-cold', 'PF7-contradiction-retires',
    ]);
  });
});

describe('[POINTERS] PF1 — a bad reaction must be caught', () => {
  const f = fx('PF1-reacts-badly');
  it('passes when a relationship pointer names the pushiness', () => {
    const good: Pointer[] = [{ section: 'relationship', text: 'She reacted badly to being pushed to sign today — back off on urgency.', receipts: [] }];
    expect(scorePointerFixture(f, good, null).pass).toBe(true);
  });
  it('fails when no pointer registers the bad reaction', () => {
    const bad: Pointer[] = [{ section: 'relationship', text: 'She is interested in the property.', receipts: [] }];
    expect(scorePointerFixture(f, bad, null).pass).toBe(false);
  });
});

describe('[POINTERS] PF2 — a pre-empted question (pleased) must be caught', () => {
  const f = fx('PF2-preempt-pleased');
  it('passes when a pointer notes the anticipation worked', () => {
    const good: Pointer[] = [{ section: 'relationship', text: 'He loved that you sent the floor plans before he asked — keep anticipating his needs.', receipts: [] }];
    expect(scorePointerFixture(f, good, null).pass).toBe(true);
  });
  it('fails when the signal is missed', () => {
    const bad: Pointer[] = [{ section: 'relationship', text: 'He is a decision maker.', receipts: [] }];
    expect(scorePointerFixture(f, bad, null).pass).toBe(false);
  });
});

describe('[POINTERS] PF3 — a thin chat yields few, specific pointers (no generic)', () => {
  const f = fx('PF3-thin');
  it('passes with a couple of specific pointers', () => {
    const good: Pointer[] = [{ section: 'relationship', text: 'She only asked for the brochure — nothing else stood out yet.', receipts: [] }];
    expect(scorePointerFixture(f, good, null).pass).toBe(true);
  });
  it('fails on a generic pointer', () => {
    const bad: Pointer[] = [{ section: 'relationship', text: 'Follow up promptly and build trust.', receipts: [] }];
    expect(scorePointerFixture(f, bad, null).pass).toBe(false);
  });
  it('fails when too many pointers are invented from a two-line chat', () => {
    const tooMany: Pointer[] = Array.from({ length: 4 }, (_, i) => ({ section: 'relationship' as const, text: `invented ${i}`, receipts: [] }));
    expect(scorePointerFixture(f, tooMany, null).pass).toBe(false);
  });
});

describe('[POINTERS] PF4 — no pointer may carry sensitive content', () => {
  const f = fx('PF4-sensitive');
  it('passes when pointers avoid the health detail', () => {
    const good: Pointer[] = [{ section: 'relationship', text: 'He asked to avoid Tuesday calls — respect that scheduling boundary.', receipts: [] }];
    expect(scorePointerFixture(f, good, null).pass).toBe(true);
  });
  it('fails when a pointer repeats the health detail', () => {
    const bad: Pointer[] = [{ section: 'relationship', text: 'Avoid calls during his chemo sessions on Tuesdays.', receipts: [] }];
    expect(scorePointerFixture(f, bad, null).pass).toBe(false);
  });
});

describe('[POINTERS] PF5 — a confirmed loss gets a retrospective + the exact disclosure', () => {
  const f = fx('PF5-lost-confirmed');
  it('passes with a retrospective pointer and the verbatim disclosure', () => {
    const good: Pointer[] = [{ section: 'retrospective', text: 'Pricing was seen as uncompetitive and follow-up as slow.', receipts: [] }];
    expect(scorePointerFixture(f, good, RETRO_DISCLOSURE).pass).toBe(true);
  });
  it('fails when the disclosure is missing', () => {
    const good: Pointer[] = [{ section: 'retrospective', text: 'Pricing was seen as uncompetitive.', receipts: [] }];
    expect(scorePointerFixture(f, good, null).pass).toBe(false);
  });
  it('fails when the disclosure wording is altered', () => {
    const good: Pointer[] = [{ section: 'retrospective', text: 'Pricing was seen as uncompetitive.', receipts: [] }];
    expect(scorePointerFixture(f, good, 'This might be why they left.').pass).toBe(false);
  });
});

describe('[POINTERS] PF6 — a going-cold deal reopens, it does NOT get a retrospective', () => {
  const f = fx('PF6-going-cold');
  it('passes with close pointers and no retrospective', () => {
    const good: Pointer[] = [{ section: 'close', text: 'He went quiet after "let me think" — re-open with a concrete next step.', receipts: [] }];
    expect(scorePointerFixture(f, good, null).pass).toBe(true);
  });
  it('fails if a retrospective is produced for a deal that was never confirmed lost', () => {
    const bad: Pointer[] = [{ section: 'retrospective', text: 'We probably lost this on price.', receipts: [] }];
    expect(scorePointerFixture(f, bad, RETRO_DISCLOSURE).pass).toBe(false);
  });
});

describe('[POINTERS] PF7 — a later contradiction retires the old pointer', () => {
  const f = fx('PF7-contradiction-retires');
  it('passes when the stale "prefers phone calls" pointer is gone', () => {
    const good: Pointer[] = [{ section: 'relationship', text: 'Now prefers WhatsApp — stop calling.', receipts: [] }];
    expect(scorePointerFixture(f, good, null).pass).toBe(true);
  });
  it('fails if the contradicted pointer is kept', () => {
    const bad: Pointer[] = [
      { section: 'relationship', text: 'prefers phone calls to messages', receipts: [] },
      { section: 'relationship', text: 'also prefers WhatsApp', receipts: [] },
    ];
    expect(scorePointerFixture(f, bad, null).pass).toBe(false);
  });
});

describe('[POINTERS] isGenericPointer', () => {
  it('flags canned advice and passes grounded specifics', () => {
    expect(isGenericPointer('follow up promptly')).toBe(true);
    expect(isGenericPointer('She reacted badly to being pushed on price')).toBe(false);
  });
});
