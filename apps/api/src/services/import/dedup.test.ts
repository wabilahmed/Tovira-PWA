import { describe, it, expect } from 'vitest';
import { dedupeMessages, renderThread } from './dedup.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

const m = (sentAt: string | null, sender: string, body: string): ImportedMessage => ({ sentAt, sender, body, media: false, role: 'unknown' });

describe('dedupeMessages (P3-7)', () => {
  it('returns only the messages not already imported', () => {
    const existing = [m('2026-01-01T09:00', 'Sara', 'hi'), m('2026-01-01T09:01', 'Alex', 'hello')];
    const incoming = [m('2026-01-01T09:00', 'Sara', 'hi'), m('2026-01-01T09:01', 'Alex', 'hello'), m('2026-02-01T10:00', 'Sara', 'new question?')];
    expect(dedupeMessages(existing, incoming)).toEqual([m('2026-02-01T10:00', 'Sara', 'new question?')]);
  });

  it('returns nothing when the whole file was already imported (idempotent re-import)', () => {
    const msgs = [m('2026-01-01T09:00', 'Sara', 'hi'), m('2026-01-01T09:01', 'Alex', 'hello')];
    expect(dedupeMessages(msgs, msgs)).toEqual([]);
  });

  it('returns everything when nothing was imported before', () => {
    const incoming = [m('2026-01-01T09:00', 'Sara', 'hi')];
    expect(dedupeMessages([], incoming)).toEqual(incoming);
  });

  it('distinguishes same text at different times / from different senders', () => {
    const existing = [m('2026-01-01T09:00', 'Sara', 'ok')];
    const incoming = [m('2026-01-01T09:00', 'Sara', 'ok'), m('2026-01-01T10:00', 'Sara', 'ok'), m('2026-01-01T09:00', 'Alex', 'ok')];
    expect(dedupeMessages(existing, incoming)).toHaveLength(2);
  });
});

describe('renderThread (P3-7)', () => {
  it('renders messages as a readable, speaker-attributed thread', () => {
    const text = renderThread([m('2026-01-01T09:00', 'Sara', 'hi'), m(null, 'Alex', 'hello')]);
    expect(text).toContain('Sara: hi');
    expect(text).toContain('Alex: hello');
  });
});
