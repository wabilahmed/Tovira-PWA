import { describe, it, expect } from 'vitest';
import { filterChatter, chatterKind } from './chatter-filter.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [P81-1 · owner, 21 Nov] The chatter pre-filter (on in production, v0.9.7): before a chat is split into pieces,
 * messages that carry nothing to extract are left out of what the model reads. They stay stored; the rep still sees
 * them. Left out: media with no caption, deleted messages, stickers, system lines, and a lone ok / okay / thanks /
 * lol / haha / emoji reply. Anything with one more word is kept.
 */
const m = (body: string, extra: Partial<ImportedMessage> = {}): ImportedMessage =>
  ({ sender: 'Khalid', role: 'client', media: false, sentAt: '2026-03-01T09:00', body, ...extra } as ImportedMessage);

describe('[P81-1] what the pre-filter leaves out', () => {
  it.each([
    ['<Media omitted>', 'media'],
    ['[media omitted]', 'media'],
    ['‎image omitted', 'media'],
    ['video omitted', 'media'],
    ['audio omitted', 'media'],
    ['GIF omitted', 'media'],
    ['document omitted', 'media'],
    ['Contact card omitted', 'media'],
    ['<attached: 00000012-PHOTO-2026-03-01-09-00-00.jpg>', 'media'],
    ['IMG-20260301-WA0001.jpg (file attached)', 'media'],
    ['This message was deleted', 'deleted'],
    ['You deleted this message.', 'deleted'],
    ['‎This message was deleted.', 'deleted'],
    ['sticker omitted', 'sticker'],
    ['<Sticker omitted>', 'sticker'],
    ['Missed voice call', 'system'],
    ['‎Missed video call', 'system'],
    ['Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.', 'system'],
    ['Waiting for this message. This may take a while.', 'system'],
    ['null', 'system'],
    ['ok', 'short_reply'],
    ['Ok.', 'short_reply'],
    ['OKAY!', 'short_reply'],
    ['okk', 'short_reply'],
    ['k', 'short_reply'],
    ['thanks', 'short_reply'],
    ['Thank you!', 'short_reply'],
    ['ok thanks', 'short_reply'],
    ['thx', 'short_reply'],
    ['lol', 'short_reply'],
    ['hahaha', 'short_reply'],
    ['Haha 😂', 'short_reply'],
    ['👍', 'short_reply'],
    ['🙏🏽🙏🏽', 'short_reply'],
    ['❤️', 'short_reply'],
    ['ok 👍', 'short_reply'],
  ])('%s is left out as %s', (body, kind) => {
    expect(chatterKind(m(body))).toBe(kind);
  });

  it('counts what it removed, by kind, and keeps the rest in order', () => {
    const msgs = [m('Can we do Thursday 3pm?'), m('ok'), m('<Media omitted>'), m("I'll send the quote by Friday", { role: 'rep', sender: 'Wabil' }), m('👍'), m('This message was deleted')];
    const r = filterChatter(msgs);
    expect(r.kept.map((x) => x.body)).toEqual(['Can we do Thursday 3pm?', "I'll send the quote by Friday"]);
    expect(r.removed).toBe(4);
    expect(r.total).toBe(6);
    expect(r.byKind).toEqual({ media: 1, deleted: 1, sticker: 0, system: 0, short_reply: 2 });
  });
});

describe('[P81-1] NEGATIVE: anything that could carry a fact is kept', () => {
  it.each([
    'ok, send it Friday',
    'ok see you at 3',
    'Okay confirmed',
    'thanks for the quote, the price is above our budget',
    'Thanks Wabil',
    'ok?',
    'no',
    'yes',
    'sure',
    'noted',
    '2.5M max',
    'Friday',
    '<Media omitted>\nhere is the floor plan we liked',
    'IMG-20260301-WA0001.jpg (file attached)\nthis one has the parking',
    'lol the price is crazy',
    'haha my son loved it',
    'ok 👍 see you Thursday',
    'The deleted message was about the budget',
    'Brandon Okay', // a name that contains the word
  ])('"%s" is kept', (body) => {
    expect(chatterKind(m(body))).toBeNull();
  });

  it('an empty chat is fine', () => {
    expect(filterChatter([])).toEqual({ kept: [], removed: 0, total: 0, byKind: { media: 0, deleted: 0, sticker: 0, system: 0, short_reply: 0 } });
  });
});
