import { describe, it, expect } from 'vitest';
import { conversationPage } from './receipt-source.js';
import type { NoteRecord, ImportedMessage } from '../../ports/note-repository.js';

/**
 * [P36-5] A conversation on the client page reads like WhatsApp: the newest messages first on screen (newest
 * day last), older ones loaded a page at a time as the rep scrolls up. Text exactly as stored; excluded
 * messages never shown; a voice note / pasted message is its one bubble.
 */
const m = (role: ImportedMessage['role'], sender: string, sentAt: string, body: string, excluded = false): ImportedMessage => ({ sender, sentAt, body, media: false, role, ...(excluded ? { excluded: true } : {}) });
const note = (messages: ImportedMessage[] | undefined, source = 'whatsapp_export', rawText = 'x'): NoteRecord =>
  ({ id: 'n1', userId: 'u', clientId: 'c1', source, rawText, audioKey: null, status: 'extracted', sweepAttempts: 0, extracted: null, messages, createdAt: Date.parse('2026-05-20T00:00:00Z') } as NoteRecord);
const many = Array.from({ length: 7 }, (_, i) => m(i % 2 ? 'rep' : 'client', i % 2 ? 'Wabil' : 'Sara', `2026-03-0${i + 1}T09:00`, `message ${i}`));

describe('[P36-5] a conversation, a page at a time', () => {
  it('the latest page first, oldest-to-newest within it; says there is more above', () => {
    const p = conversationPage(note(many), undefined, 3);
    expect(p.source.bubbles.map((b) => b.text)).toEqual(['message 4', 'message 5', 'message 6']);
    expect(p.from).toBe(4);
    expect(p.source.hasMore).toBe(true);
    expect(p.source.bubbles.every((b) => !b.source)).toBe(true); // a conversation, not a receipt — nothing outlined
  });

  it('the page before a given index; the first page says there is nothing older', () => {
    const p = conversationPage(note(many), 4, 3);
    expect(p.source.bubbles.map((b) => b.text)).toEqual(['message 1', 'message 2', 'message 3']);
    const first = conversationPage(note(many), 1, 3);
    expect(first.source.bubbles.map((b) => b.text)).toEqual(['message 0']);
    expect(first.from).toBe(0);
    expect(first.source.hasMore).toBe(false);
  });

  it('excluded messages are never shown; sides come from the stored roles', () => {
    const p = conversationPage(note([m('client', 'Sara', '2026-03-01T09:00', 'hi'), m('client', 'Sara', '2026-03-01T09:01', 'secret', true), m('rep', 'Wabil', '2026-03-01T09:02', 'hello')]), undefined, 50);
    expect(p.source.bubbles.map((b) => [b.text, b.side])).toEqual([['hi', 'other'], ['hello', 'rep']]);
  });

  it('a voice note is one rep-side voice bubble', () => {
    const p = conversationPage(note(undefined, 'voice', 'Call Sara about the villa'), undefined, 50);
    expect(p.source.bubbles).toEqual([expect.objectContaining({ text: 'Call Sara about the villa', side: 'rep', voice: true })]);
    expect(p.source.hasMore).toBe(false);
  });
});
