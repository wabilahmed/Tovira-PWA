import { describe, it, expect } from 'vitest';
import { sourceFromNote, threadFromNote, quoteOnlySource } from './receipt-source.js';
import type { NoteRecord, ImportedMessage } from '../../ports/note-repository.js';

/**
 * [P35-3] Every receipt renders as a WhatsApp-style chat. The server finds the message a fact came from (its
 * stored span + message time) and returns it — and up to 3 messages either side — as bubbles with the sender's
 * SIDE from the import's rep identification (never guessed: an unidentified chat puts everyone on the other
 * side). Voice notes and the rep's own notes are rep-side bubbles. Text is exactly as stored.
 */
const m = (role: ImportedMessage['role'], sender: string, sentAt: string, body: string, excluded = false): ImportedMessage => ({ sender, sentAt, body, media: false, role, ...(excluded ? { excluded: true } : {}) });
const chat = (messages: ImportedMessage[]): NoteRecord => ({ id: 'n1', userId: 'u', clientId: 'c1', source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted', sweepAttempts: 0, extracted: null, messages, createdAt: Date.parse('2026-05-20T00:00:00Z') });
const MSGS = [
  m('client', 'Sara Khan', '2026-03-01T09:00', 'Hello'),
  m('rep', 'Wabil', '2026-03-01T09:05', 'Hi Sara'),
  m('client', 'Sara Khan', '2026-03-02T10:00', 'Any news on the villa?'),
  m('client', 'Sara Khan', '2026-03-02T10:01', 'We also need parking'),
  m('rep', 'Wabil', '2026-03-02T10:20', "Great, I'll send you the floor plans tomorrow"),
  m('client', 'Sara Khan', '2026-03-02T10:25', 'Thanks'),
  m('client', 'Sara Khan', '2026-03-03T08:00', 'Morning'),
  m('rep', 'Wabil', '2026-03-03T08:10', 'Morning!'),
  m('client', 'Sara Khan', '2026-03-03T08:15', 'Call me later'),
];

describe('[P35-3] the source message of a receipt', () => {
  it('finds the message by its stored span; the rep\'s message is on the rep side, the client\'s on the other', () => {
    const s = sourceFromNote(chat(MSGS), { span: "I'll send you the floor plans tomorrow", at: '2026-03-02T10:20' });
    const src = s.bubbles.find((b) => b.source)!;
    expect(src).toMatchObject({ sender: 'Wabil', side: 'rep', at: '2026-03-02T10:20', text: "Great, I'll send you the floor plans tomorrow" });
    expect(s.bubbles.find((b) => b.text === 'Thanks')!.side).toBe('other');
    expect(s.repKnown).toBe(true);
  });

  it('up to 3 messages either side of the source — never more', () => {
    const s = sourceFromNote(chat(MSGS), { span: "I'll send you the floor plans tomorrow", at: '2026-03-02T10:20' });
    const i = s.bubbles.findIndex((b) => b.source);
    expect(i).toBeLessThanOrEqual(3);
    expect(s.bubbles.length - i - 1).toBeLessThanOrEqual(3);
    expect(s.bubbles.map((b) => b.text)).toEqual(['Hi Sara', 'Any news on the villa?', 'We also need parking', "Great, I'll send you the floor plans tomorrow", 'Thanks', 'Morning', 'Morning!']);
    expect(s.hasMore).toBe(true);
  });

  it('the full thread on request; excluded (held) messages never appear', () => {
    const t = threadFromNote(chat([...MSGS, m('client', 'Sara Khan', '2026-03-04T09:00', 'sensitive', true)]), { span: 'Hello' }, 'full');
    expect(t.bubbles).toHaveLength(9);
    expect(t.bubbles.some((b) => b.text === 'sensitive')).toBe(false);
  });

  it('an unidentified chat (no rep among the senders) puts everyone on the other side, with names', () => {
    const s = sourceFromNote(chat(MSGS.map((x) => ({ ...x, role: 'unknown' as const }))), { span: 'We also need parking' });
    expect(s.repKnown).toBe(false);
    expect(s.bubbles.every((b) => b.side === 'other' && b.sender.length > 0)).toBe(true);
  });

  it('a voice note → one rep-side "Voice note" bubble with the transcript excerpt', () => {
    const voice: NoteRecord = { ...chat([]), source: 'voice', messages: null, rawText: 'Met Sara. She needs parking for two cars. Follow up Friday.' };
    const s = sourceFromNote(voice, { span: 'She needs parking for two cars' });
    expect(s.kind).toBe('voice');
    expect(s.bubbles).toEqual([expect.objectContaining({ side: 'rep', sender: 'Voice note', voice: true, source: true, text: 'She needs parking for two cars' })]);
  });

  it('a pasted / typed note → one rep-side "Your note" bubble', () => {
    const paste: NoteRecord = { ...chat([]), source: 'paste', messages: null, rawText: 'Remember that Sara increased her budget to 2.2M' };
    const s = sourceFromNote(paste, {});
    expect(s.bubbles).toEqual([expect.objectContaining({ side: 'rep', sender: 'Your note', text: 'Remember that Sara increased her budget to 2.2M' })]);
  });

  it('no note to look in → a single bubble from the quote, on the other side, named', () => {
    const s = quoteOnlySource({ quote: 'looking for a 2BR in JVC', at: '2026-04-12', sender: 'QA P14 Gate Client' });
    expect(s.bubbles).toEqual([expect.objectContaining({ sender: 'QA P14 Gate Client', side: 'other', text: 'looking for a 2BR in JVC', source: true })]);
  });

  it('text is exactly as stored (a redacted value stays redacted)', () => {
    const s = sourceFromNote(chat([m('client', 'Sara Khan', '2026-03-02T10:00', 'my card is [REDACTED]')]), { span: '[REDACTED]' });
    expect(s.bubbles[0]!.text).toBe('my card is [REDACTED]');
  });
});
