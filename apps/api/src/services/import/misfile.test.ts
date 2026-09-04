import { describe, it, expect } from 'vitest';
import { detectMisfileAtImport, type MisfileInput } from './misfile.js';
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

  it('does NOT nag on a first import of a fresh client (no phone, no known people, no other match)', () => {
    const r = detectMisfileAtImport({
      knownPeople: [],
      selected: { id: 'new', name: 'Downtown Living', phone: null },
      others: [],
      messages: [msg('Faisal'), msg('Me')], // we simply cannot tell yet
    });
    expect(r.status).toBe('ok');
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
