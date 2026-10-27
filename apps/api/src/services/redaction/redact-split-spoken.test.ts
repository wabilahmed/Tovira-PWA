import { describe, it, expect } from 'vitest';
import { redactSensitive, redactMessages } from './redact.js';

// [P50-0 · owner] Redaction caught every typed Tier-1 format except three: a card number split over two messages, and a
// card or Emirates ID read out in words in a voice note. Tier-1 values are never stored, so all three are blanked now.
// The false-positive posture stays: Luhn for cards, the 784 prefix and 15 digits for an Emirates ID, and a split is joined
// only across consecutive messages from the same sender.
const CARD = ['4539', '1488', '0343', '6467']; // Luhn-valid 4539 1488 0343 6467
const noFragment = (text: string, parts: string[]) => parts.slice(0, 3).forEach((p) => expect(text, `fragment ${p}`).not.toContain(p));

describe('[P50-0] a card number split over consecutive messages', () => {
  it('in a raw chat (bracketed timestamps), both halves are blanked', () => {
    const r = redactSensitive('[10/06/2026, 09:10] Omar: first half 4539 1488\n[10/06/2026, 09:11] Omar: second half 0343 6467\n[10/06/2026, 09:12] Rep: got it');
    noFragment(r.redacted, CARD);
    expect(r.redacted).toContain('[card ending 6467]');
    expect(r.redacted).toContain('Omar: first half [card number redacted]');
    expect(r.redacted).toContain('Rep: got it');
    expect(r.counts.card).toBe(1);
  });

  it('in a raw chat (Android dash format), and over three messages', () => {
    const r = redactSensitive('10/06/2026, 9:10 am - Omar: card is 4539\n10/06/2026, 9:10 am - Omar: 1488 0343\n10/06/2026, 9:11 am - Omar: 6467 thanks');
    noFragment(r.redacted, CARD);
    expect(r.redacted).toContain('[card ending 6467]');
  });

  it('in parsed messages (what imports store), both halves are blanked', () => {
    const out = redactMessages([
      { sender: 'Omar', body: 'first half 4539 1488' },
      { sender: 'Omar', body: 'second half 0343 6467' },
      { sender: 'Rep', body: 'thanks' },
    ]);
    noFragment(out.messages.map((m) => m.body).join(' '), CARD);
    expect(out.messages[1]!.body).toBe('second half [card ending 6467]');
    expect(out.messages[2]!.body).toBe('thanks');
    expect(out.total).toBe(1);
  });

  it('NEGATIVE: numbers from two different senders are never joined', () => {
    const out = redactMessages([{ sender: 'Omar', body: 'ref 4539 1488' }, { sender: 'Rep', body: 'ok 0343 6467' }]);
    expect(out.messages.map((m) => m.body)).toEqual(['ref 4539 1488', 'ok 0343 6467']);
    expect(out.total).toBe(0);
  });

  it('NEGATIVE: order numbers and prices in consecutive messages that do not form a card stay', () => {
    const out = redactMessages([{ sender: 'Omar', body: 'order 1234 5678' }, { sender: 'Omar', body: 'and 9012 3456' }]);
    expect(out.messages.map((m) => m.body)).toEqual(['order 1234 5678', 'and 9012 3456']); // fails Luhn
    expect(redactSensitive('[1] Omar: AED 4500\n[2] Omar: AED 1200 for 3 units').total).toBe(0);
  });
});

describe('[P50-0] a card or Emirates ID read out in words (a voice note)', () => {
  it('an Emirates ID in English words is blanked', () => {
    const r = redactSensitive('his emirates id is seven eight four one nine nine zero one two three four five six seven one, ok');
    expect(r.redacted).toBe('his emirates id is [Emirates ID redacted], ok');
    expect(r.counts.emirates_id).toBe(1);
  });

  it('an Emirates ID in Arabic number words is blanked', () => {
    const r = redactSensitive('رقم الهوية سبعة ثمانية أربعة واحد تسعة تسعة صفر واحد اثنين ثلاثة أربعة خمسة ستة سبعة واحد');
    expect(r.redacted).toBe('رقم الهوية [Emirates ID redacted]');
  });

  it('a card number in words (with "oh" for zero and "double") is blanked to its last four', () => {
    const r = redactSensitive('card number four five three nine one four double eight oh three four three six four six seven please');
    expect(r.redacted).toBe('card number [card ending 6467] please');
    expect(r.counts.card).toBe(1);
  });

  it('NEGATIVE: a phone number, a quantity or a short run of number words is left alone', () => {
    for (const t of [
      'call me on zero five zero one two three four five six seven',
      'we need seven eight units and one two three boxes',
      'one two three four five six seven eight nine one two three four five', // 15 digits, not 784, fails Luhn
    ]) expect(redactSensitive(t).redacted, t).toBe(t);
  });
});

describe('[P50-0] the blanked card keeps the space after it', () => {
  it('"Card 4539-1488-0343-6467 for" keeps "] for"', () => {
    expect(redactSensitive('Card 4539-1488-0343-6467 for the deposit').redacted).toBe('Card [card ending 6467] for the deposit');
  });
});
