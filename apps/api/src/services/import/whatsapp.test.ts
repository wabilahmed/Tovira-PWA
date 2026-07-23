import { describe, it, expect } from 'vitest';
import { parseWhatsAppExport } from './whatsapp.js';

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
