import { describe, it, expect } from 'vitest';
import { detectMisfileAtImport, detectMisfilePostExtraction, type MisfileInput } from './misfile.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

const msg = (sender: string, body = 'hi'): ImportedMessage => ({ sentAt: '2026-03-15T10:00:00Z', sender, body, media: false, role: 'unknown' });

const base: Omit<MisfileInput, 'messages' | 'selected'> = { knownPeople: [], others: [] };

describe('[MISFILE-DETECT] detectMisfileAtImport', () => {
  it('no prompt when a participant matches the selected client by name', () => {
    const r = detectMisfileAtImport({ ...base, selected: { id: 'c1', name: 'Ahmed', phone: null }, messages: [msg('Ahmed'), msg('Me')] });
    expect(r.status).toBe('ok');
  });

  it('no prompt when a participant matches a known person on the stakeholder map', () => {
    const r = detectMisfileAtImport({ ...base, knownPeople: ['Sarah', 'Jordan'], selected: { id: 'c1', name: 'Meridian', phone: null }, messages: [msg('Sarah Lee'), msg('Me')] });
    expect(r.status).toBe('ok');
  });

  it('no prompt when the counterpart phone matches the stored client phone (strongest signal)', () => {
    const r = detectMisfileAtImport({ ...base, selected: { id: 'c1', name: 'Meridian', phone: '+971 50 123 4567' }, messages: [msg('+971501234567'), msg('Me')] });
    expect(r.status).toBe('ok');
  });

  it('CLEAR mismatch → prompt WITH the suggested correct client', () => {
    const r = detectMisfileAtImport({
      knownPeople: ['Sarah'],
      selected: { id: 'meridian', name: 'Meridian', phone: null },
      others: [{ id: 'ahmed', name: 'Ahmed', phone: null, knownPeople: [] }],
      messages: [msg('Ahmed'), msg('Me')],
    });
    expect(r.status).toBe('mismatch');
    if (r.status !== 'mismatch') return;
    expect(r.suggestion).toEqual({ id: 'ahmed', name: 'Ahmed' });
    expect(r.counterparts).toContain('Ahmed');
  });

  it('AMBIGUOUS mismatch → prompt WITHOUT a suggestion (checkable client, no other match)', () => {
    const r = detectMisfileAtImport({
      knownPeople: ['Sarah', 'Jordan'], // the selected client has identity to check
      selected: { id: 'meridian', name: 'Meridian', phone: null },
      others: [{ id: 'x', name: 'Northwind', phone: null, knownPeople: ['Bianca'] }],
      messages: [msg('Bob Random'), msg('Me')], // matches neither Meridian nor Northwind
    });
    expect(r.status).toBe('mismatch');
    if (r.status !== 'mismatch') return;
    expect(r.suggestion).toBeNull();
  });

  it('matches several other clients → mismatch without a single suggestion', () => {
    const r = detectMisfileAtImport({
      knownPeople: [],
      selected: { id: 'meridian', name: 'Meridian', phone: null },
      others: [
        { id: 'a', name: 'Ahmed', phone: null, knownPeople: [] },
        { id: 'b', name: 'Ahmed', phone: null, knownPeople: [] }, // two clients a participant matches
      ],
      messages: [msg('Ahmed'), msg('Me')],
    });
    expect(r.status).toBe('mismatch');
    if (r.status !== 'mismatch') return;
    expect(r.suggestion).toBeNull();
  });

  // [ALIAS] The counterpart is saved under a name that isn't the client's (a nickname/company).
  // We now CONFIRM once (softly) before extraction, so we can learn the alias and never nag again —
  // the ordering rule. The counterpart is identified for the prompt + the alias to store.
  it('confirms the counterpart on a first import when it does not match, naming it to learn the alias', () => {
    const r = detectMisfileAtImport({
      knownPeople: [],
      selected: { id: 'new', name: 'Downtown Living', phone: null },
      others: [],
      messages: [msg('Faisal'), msg('Me')], // "Me" is the rep's self-label → sole counterpart is Faisal
    });
    expect(r.status).toBe('mismatch');
    expect(r.counterpart).toBe('Faisal');
  });

  // [ALIAS] Once "Faisal" is a learned alias of this client, the same import is silent.
  it('does NOT prompt when the counterpart matches a learned alias', () => {
    const r = detectMisfileAtImport({
      knownPeople: [],
      selected: { id: 'new', name: 'Downtown Living', phone: null, aliases: ['Faisal'] },
      others: [],
      messages: [msg('Faisal'), msg('Me')],
    });
    expect(r.status).toBe('ok');
  });

  // [ALIAS-COUNTERPART] With the rep's own name known, the counterpart is the OTHER speaker.
  it('identifies the counterpart by elimination against the rep name (two real-name speakers)', () => {
    const r = detectMisfileAtImport({
      ...base,
      repName: 'Wabil',
      selected: { id: 'c1', name: 'Imtinan', phone: null, aliases: ['Bubu DXB'] },
      messages: [msg('Wabil'), msg('Bubu DXB')],
    });
    expect(r.status).toBe('ok'); // alias matches → no prompt
    expect(r.counterpart).toBe('Bubu DXB'); // rep 'Wabil' eliminated
  });

  // [ALIAS] A group chat (>2 speakers) does not get the two-speaker counterpart rule.
  it('flags a group chat and does not assert a single counterpart', () => {
    const r = detectMisfileAtImport({
      ...base,
      repName: 'Wabil',
      selected: { id: 'c1', name: 'Imtinan', phone: null },
      messages: [msg('Wabil'), msg('Bubu DXB'), msg('Third Person')],
    });
    expect(r.group).toBe(true);
    expect(r.counterpart).toBeNull();
  });

  it('a phone that does not match the stored phone, with no other match, is flagged (had identity)', () => {
    const r = detectMisfileAtImport({
      knownPeople: [],
      selected: { id: 'c1', name: 'Meridian', phone: '+971 50 000 0000' },
      others: [],
      messages: [msg('+971509999999'), msg('Me')],
    });
    expect(r.status).toBe('mismatch');
  });
});

describe('[MISFILE-POST] detectMisfilePostExtraction (voice notes, content-only)', () => {
  it('no suggestion when the note mentions someone on the filed client record (overlap)', () => {
    const r = detectMisfilePostExtraction({
      notePeople: ['Sarah'],
      filedClient: { id: 'meridian', name: 'Meridian' },
      filedClientOtherPeople: ['Sarah', 'Jordan'],
      others: [{ id: 'ahmed', name: 'Ahmed', people: ['Sarah'] }],
    });
    expect(r.status).toBe('ok');
  });

  it('suggests a move when the note mentions ONLY another client\'s people (zero overlap with filed)', () => {
    const r = detectMisfilePostExtraction({
      notePeople: ['Sarah', 'Jordan'],
      filedClient: { id: 'newco', name: 'Newco' },
      filedClientOtherPeople: [], // nobody on Newco's record
      others: [{ id: 'meridian', name: 'Meridian', people: ['Sarah', 'Jordan', 'Klaus'] }],
    });
    expect(r.status).toBe('suggest_move');
    if (r.status !== 'suggest_move') return;
    expect(r.to).toEqual({ id: 'meridian', name: 'Meridian' });
    expect(r.mentioned).toEqual(['Sarah', 'Jordan']);
    expect(r.reason).toMatch(/Meridian's record/);
  });

  it('stays silent (conservative) when the note mentions people on NO client — over-flagging is the enemy', () => {
    const r = detectMisfilePostExtraction({
      notePeople: ['Faisal'],
      filedClient: { id: 'newco', name: 'Newco' },
      filedClientOtherPeople: [],
      others: [{ id: 'meridian', name: 'Meridian', people: ['Sarah'] }],
    });
    expect(r.status).toBe('ok');
  });

  it('does not suggest when overlap exists even if another client also matches (require ZERO overlap)', () => {
    const r = detectMisfilePostExtraction({
      notePeople: ['Sarah', 'Bianca'],
      filedClient: { id: 'meridian', name: 'Meridian' },
      filedClientOtherPeople: ['Sarah'], // Sarah IS on Meridian → overlap → correctly filed
      others: [{ id: 'northwind', name: 'Northwind', people: ['Bianca'] }],
    });
    expect(r.status).toBe('ok');
  });

  it('no suggestion when the note mentions nobody', () => {
    const r = detectMisfilePostExtraction({ notePeople: [], filedClient: { id: 'x', name: 'X' }, filedClientOtherPeople: [], others: [] });
    expect(r.status).toBe('ok');
  });

  it('names the mentioned people without a single suggestion when several other clients match', () => {
    const r = detectMisfilePostExtraction({
      notePeople: ['Sarah'],
      filedClient: { id: 'newco', name: 'Newco' },
      filedClientOtherPeople: [],
      others: [
        { id: 'a', name: 'ClientA', people: ['Sarah'] },
        { id: 'b', name: 'ClientB', people: ['Sarah'] },
      ],
    });
    expect(r.status).toBe('suggest_move');
    if (r.status !== 'suggest_move') return;
    expect(r.to).toBeNull(); // ambiguous — several clients have a Sarah
    expect(r.mentioned).toContain('Sarah');
  });
});
