import { describe, it, expect } from 'vitest';
import { parseWhatsAppExport } from './whatsapp.js';
import { syntheticWhatsAppExport } from './__fixtures__/synthetic-whatsapp-export.js';

describe('parseWhatsAppExport (P1-4b)', () => {
  // POSITIVE: a real-format export with two speakers over months.
  it('parses [date] Name: message lines into ordered, speaker-attributed records', () => {
    const text = [
      '[2026-01-15, 09:12:03] Sara Lee: Morning! Did the revised quote come through?',
      '[2026-01-15, 09:40:11] Alex Rep: Sending it over today.',
      '[2026-03-02, 14:05:00] Sara Lee: Thanks — looks good.',
    ].join('\n');
    const res = parseWhatsAppExport(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.messages).toHaveLength(3);
    expect(res.messages[0]).toMatchObject({
      sender: 'Sara Lee',
      sentAt: '2026-01-15T09:12:03',
      body: 'Morning! Did the revised quote come through?',
      media: false,
    });
    expect(res.messages[1]!.sender).toBe('Alex Rep');
    // Order preserved across a 3-month gap.
    expect(res.messages[2]!.sentAt).toBe('2026-03-02T14:05:00');
  });

  // POSITIVE: a multi-line message stays ONE message.
  it('keeps a multi-line message as a single message, not split per line', () => {
    const text = [
      '[2026-01-15, 09:12:03] Sara Lee: Here are my questions:',
      'Can you do bulk pricing?',
      'And what about onboarding time?',
      '[2026-01-15, 09:40:11] Alex Rep: Great questions.',
    ].join('\n');
    const res = parseWhatsAppExport(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.messages).toHaveLength(2);
    expect(res.messages[0]!.body).toBe(
      'Here are my questions:\nCan you do bulk pricing?\nAnd what about onboarding time?',
    );
  });

  // POSITIVE: media placeholders are recognised, not stored as garbage facts.
  it('handles media placeholders gracefully (media flag, no garbage body)', () => {
    const text = [
      '[2026-01-15, 09:12:03] Sara Lee: ‎<Media omitted>',
      '[2026-01-15, 09:13:00] Alex Rep: image omitted',
      '[2026-01-15, 09:14:00] Sara Lee: See attached spec.',
    ].join('\n');
    const res = parseWhatsAppExport(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.messages[0]!.media).toBe(true);
    expect(res.messages[1]!.media).toBe(true);
    expect(res.messages[2]!.media).toBe(false);
  });

  // POSITIVE: tolerate the unicode control chars + 12h AM/PM real exports carry.
  it('tolerates LTR/narrow-space control chars and 12-hour AM/PM timestamps', () => {
    const text = '[2026-01-15, 2:30:45 PM] Sara Lee: ‎Hello there';
    const res = parseWhatsAppExport(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.messages[0]!.sender).toBe('Sara Lee');
    expect(res.messages[0]!.sentAt).toBe('2026-01-15T14:30:45');
    expect(res.messages[0]!.body).toBe('Hello there');
  });

  // A colon inside the message body must not break sender parsing.
  it('splits on the first ": " only — a colon in the body is preserved', () => {
    const res = parseWhatsAppExport('[2026-01-15, 09:12:03] Sara Lee: Re: pricing question');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.messages[0]!.sender).toBe('Sara Lee');
    expect(res.messages[0]!.body).toBe('Re: pricing question');
  });

  // NEGATIVE: random non-WhatsApp text is rejected, not coerced into messages.
  it('rejects text that does not look like a WhatsApp export', () => {
    const res = parseWhatsAppExport('just some random notes\nthat i typed\nno timestamps here');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/whatsapp/i);
  });

  // NEGATIVE: empty / whitespace input is rejected.
  it('rejects empty or whitespace-only input', () => {
    expect(parseWhatsAppExport('').ok).toBe(false);
    expect(parseWhatsAppExport('   \n  \t ').ok).toBe(false);
  });
});

// [PARSE-REAL] Validate the parser against a synthetic export shaped exactly like the real
// 5,940-message file: dash/Android format, day-first dates 2019→2026, 516 media, 2 system lines,
// 276 continuation lines.
describe('[PARSE-REAL] the real-file shape', () => {
  it('parses the dash/Android format with day-first dates (not just bracketed iOS ISO)', () => {
    const res = parseWhatsAppExport('13/07/2019, 5:28 am - Wabil: Pohonch gaya');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.messages[0]).toMatchObject({ sender: 'Wabil', body: 'Pohonch gaya' });
    // Day-first 13/07/2019 → 2019-07-13 (NOT month-first, and the YEAR is 2019 — the reference-date anchor).
    expect(res.messages[0]!.sentAt).toBe('2019-07-13T05:28:00');
  });

  it('resolves 12h pm and a 2-digit year', () => {
    const res = parseWhatsAppExport('03/06/26, 9:05 pm - Sara: hi');
    expect(res.ok && res.messages[0]!.sentAt).toBe('2026-06-03T21:05:00');
  });

  it('a mid-file system notice is skipped, NOT folded into the previous message', () => {
    const res = parseWhatsAppExport(
      ['13/07/2019, 5:10 am - Bilal: first', '13/07/2019, 5:11 am - You changed the group description', '13/07/2019, 5:12 am - Bilal: second'].join('\n'),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.messages).toHaveLength(2); // the system line produced no message and joined to none
    expect(res.messages[0]!.body).toBe('first'); // not corrupted with the notice text
    expect(res.messages.map((m) => m.body)).toEqual(['first', 'second']);
  });

  it('matches the real file across every property (counts, media, system, continuations, span)', () => {
    const { text, expected } = syntheticWhatsAppExport();
    const res = parseWhatsAppExport(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { messages } = res;
    expect(messages).toHaveLength(expected.messages); // 5,940 — system skipped, continuations joined
    const bySender: Record<string, number> = {};
    for (const m of messages) bySender[m.sender] = (bySender[m.sender] ?? 0) + 1;
    expect(bySender).toEqual(expected.bySender); // 3010 / 2930, no phantom "system" sender
    expect(messages.filter((m) => m.media).length).toBe(expected.media); // 516 <Media omitted>
    // Continuation lines joined into their message (multi-line body), not dropped or split.
    expect(messages.filter((m) => m.body.includes('\n')).length).toBe(expected.continuations);
    // Date span preserved: earliest 2019, latest 2026.
    const dated = messages.map((m) => m.sentAt).filter((s): s is string => s !== null).sort();
    expect(dated.length).toBe(expected.messages); // EVERY message got a real date (the DD/MM fix)
    expect(dated[0]!.startsWith(expected.firstYear)).toBe(true);
    expect(dated.at(-1)!.startsWith(expected.lastYear)).toBe(true);
  });
});
