import { describe, it, expect } from 'vitest';
import { restrictNote } from './restrict-note.js';
import { restrictionForNames } from './restriction.js';
import type { NoteRecord } from '../../ports/note-repository.js';

/**
 * [P47 · found by the self-discovering erasure guard] A pasted chat still waiting for extraction has no parsed messages,
 * so the restricted person's own lines ("Khalid: …") survived in its text. Their lines are now withheld the same way
 * their messages are; the rest of the paste stays, and a paste in the rep's own words that merely mentions them is
 * kept (the existing about-versus-mention rule).
 */
const r = restrictionForNames(['Khalid']);
const paste = (rawText: string): NoteRecord => ({ id: 'n1', userId: 'u', clientId: 'c', source: 'paste', rawText, audioKey: null, status: 'pending_extraction', createdAt: 1, messages: null, extracted: null } as unknown as NoteRecord);

describe('[P47] a pasted chat\'s lines from the restricted person', () => {
  it('their speaker lines are withheld; the others stay', () => {
    expect(restrictNote(paste('Khalid: can we move the viewing to Friday?\nRep: sure, Friday 4pm'), r).rawText).toBe('Rep: sure, Friday 4pm');
    expect(restrictNote(paste('[12/03/2026, 10:05] Khalid: send the plans\n[12/03/2026, 10:06] Omar: me too'), r).rawText).toBe('[12/03/2026, 10:06] Omar: me too');
  });
  it('a paste that is only their lines leaves nothing', () => {
    expect(restrictNote(paste('Khalid: hello\nKhalid: are you there?'), r).rawText).toBeNull();
  });
  it('NEGATIVE: a paste in the rep\'s own words that mentions them is kept whole', () => {
    expect(restrictNote(paste('Met Khalid today, he wants a villa'), r).rawText).toBe('Met Khalid today, he wants a villa');
  });
  it('NEGATIVE: no restriction → untouched', () => {
    const n = paste('Khalid: hello');
    expect(restrictNote(n, restrictionForNames([]))).toBe(n);
  });
});
