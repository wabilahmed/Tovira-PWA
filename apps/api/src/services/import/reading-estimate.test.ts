import { describe, it, expect } from 'vitest';
import { messagesToRead, readingEstimate, readingLine } from './reading-estimate.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [P82-B · owner, 21 Nov] Messages are the only currency reps see, counted STRIPPED: the messages Tovira reads, after
 * the sensitive screen and the chatter pre-filter, never the raw export count. Before an import: "This chat has 1,240
 * messages to read. About 3 minutes." No cost. Minutes are measured: a live chat reads 4 pieces at a time, about
 * 1.7 minutes a round (19-21 Nov: 8-10 pieces in 3.7-5.8 min); a batched bulk import about 3 minutes a round of up to
 * 16 pieces (165-184 s per batch).
 */
const m = (body: string, extra: Partial<ImportedMessage> = {}): ImportedMessage => ({ sender: 'A', role: 'client', media: false, sentAt: '2026-03-01T09:00', body, ...extra } as ImportedMessage);
const chat = (n: number) => Array.from({ length: n }, (_, i) => m(`message ${i}`));

describe('[P82-B] messages to read are stripped', () => {
  it('chatter and held messages are not counted', () => {
    expect(messagesToRead([m('Can we meet Thursday?'), m('ok'), m('<Media omitted>'), m('👍'), m('held', { excluded: true }), m('I will send the quote')])).toBe(2);
  });
  it('NEGATIVE: a chat with no chatter counts every message', () => {
    expect(messagesToRead(chat(40))).toBe(40);
  });
});

describe('[P82-B] the estimate and the line', () => {
  it('a short chat (one piece) reads in about 1 minute', () => {
    expect(readingEstimate(chat(100), 'live')).toEqual({ messages: 100, pieces: 1, minutes: 1 });
  });
  it('1,240 messages live: 12 pieces, 3 rounds of 4, about 5 minutes', () => {
    expect(readingEstimate(chat(1240), 'live')).toEqual({ messages: 1240, pieces: 12, minutes: 5 });
  });
  it('batched: up to 16 pieces a round, about 3 minutes a round', () => {
    expect(readingEstimate(chat(1240), 'batch').minutes).toBe(3);
    expect(readingEstimate(chat(2500), 'batch').minutes).toBe(6);
  });
  it('the line, with thousands separators and the right plural', () => {
    expect(readingLine({ messages: 1240, minutes: 3 })).toBe('This chat has 1,240 messages to read. About 3 minutes.');
    expect(readingLine({ messages: 1, minutes: 1 })).toBe('This chat has 1 message to read. About 1 minute.');
    expect(readingLine({ messages: 3200, minutes: 9 }, 3)).toBe('These 3 chats have 3,200 messages to read. About 9 minutes.');
  });
  it('NEGATIVE: the line never carries a currency or a cost', () => {
    const l = readingLine({ messages: 1240, minutes: 3 });
    expect(l).not.toMatch(/AED|\$|cost|spend|credit|%/i);
  });
});
