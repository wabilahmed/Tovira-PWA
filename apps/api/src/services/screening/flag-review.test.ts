import { describe, it, expect } from 'vitest';
import { groupHeldFlags, restoreFlags } from './flag-review.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [SCREEN-REVIEW] Grouping + restore are pure functions over a note's messages. The review groups held
 * messages category → matched span so a rep can clear a dominant false-positive token in one action;
 * restore flips excluded=false (fail-closed: ONLY restore clears it) and reports the flags cleared, which
 * become the aggregate restore signal (R2).
 */
const M = (over: Partial<ImportedMessage> & { body: string }): ImportedMessage => ({ sentAt: 't', sender: 'Client', media: false, role: 'client', ...over });

// Two held on "party" (political), one held on "hospital" (health), one clean.
function fixture(): ImportedMessage[] {
  return [
    M({ body: 'the party is on Friday', excluded: true, sensitive: [{ category: 'political_opinion', span: 'party', index: 4 }] }),
    M({ body: 'another party next week', excluded: true, sensitive: [{ category: 'political_opinion', span: 'party', index: 8 }] }),
    M({ body: 'he is in hospital', excluded: true, sensitive: [{ category: 'health', span: 'hospital', index: 9 }] }),
    M({ body: 'send the floor plan for unit 12' }),
  ];
}

describe('[SCREEN-REVIEW] groupHeldFlags — category → span with counts', () => {
  it('groups only HELD messages by category then matched span', () => {
    const g = groupHeldFlags(fixture());
    expect(g.held).toBe(3); // three held; the clean one is not counted
    const political = g.groups.find((c) => c.category === 'political_opinion')!;
    expect(political.count).toBe(2);
    const partySpan = political.spans.find((s) => s.span === 'party')!;
    expect(partySpan.count).toBe(2);
    expect(partySpan.messages.map((m) => m.body)).toEqual(['the party is on Friday', 'another party next week']);
    // the message index locates it for a targeted restore
    expect(partySpan.messages[0]!.index).toBe(0);
    expect(g.groups.find((c) => c.category === 'health')!.count).toBe(1);
  });
  it('a note with no held messages yields nothing to review', () => {
    expect(groupHeldFlags([M({ body: 'all clean here' })])).toEqual({ held: 0, groups: [] });
  });
});

describe('[SCREEN-REVIEW] restoreFlags — individual, bulk-by-span, bulk-by-category', () => {
  it('bulk-by-span clears the dominant token in ONE action, leaving other flags held', () => {
    const r = restoreFlags(fixture(), { category: 'political_opinion', span: 'party' });
    expect(r.restored).toBe(2); // both "party" messages
    expect(r.messages[0]!.excluded).toBe(false);
    expect(r.messages[1]!.excluded).toBe(false);
    expect(r.messages[2]!.excluded).toBe(true); // the hospital message is untouched — still held
    // the cleared flags become the restore signal
    expect(r.signals).toEqual([{ category: 'political_opinion', span: 'party' }, { category: 'political_opinion', span: 'party' }]);
  });
  it('bulk-by-category clears every span in the category', () => {
    const r = restoreFlags(fixture(), { category: 'political_opinion' });
    expect(r.restored).toBe(2);
    expect(r.messages[2]!.excluded).toBe(true); // health untouched
  });
  it('individual restore clears one message by index and signals its flags', () => {
    const r = restoreFlags(fixture(), { index: 2 });
    expect(r.restored).toBe(1);
    expect(r.messages[2]!.excluded).toBe(false);
    expect(r.messages[0]!.excluded).toBe(true); // the party messages stay held
    expect(r.signals).toEqual([{ category: 'health', span: 'hospital' }]);
  });
  it('restoring an already-restored / non-held message is a no-op (nothing to clear)', () => {
    const r = restoreFlags(fixture(), { index: 3 }); // the clean message
    expect(r.restored).toBe(0);
    expect(r.signals).toEqual([]);
  });
  it('does not mutate the input array (returns a new one)', () => {
    const input = fixture();
    restoreFlags(input, { category: 'political_opinion', span: 'party' });
    expect(input[0]!.excluded).toBe(true); // original untouched
  });
});
