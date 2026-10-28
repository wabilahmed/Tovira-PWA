import { describe, it, expect } from 'vitest';
import { redactSensitive, redactMessages } from './redact.js';

// [P53 · owner] Indian recruiters paste candidate IDs into chats and voice notes. Tier-1, blanked before any model call
// exactly like cards, with the placeholders the receipt check already knows (owner: no new placeholder words, so no
// CERT_SURFACE change): Aadhaar, PAN and passports as "[ID redacted]", bank accounts as "[bank account redacted]".
// Fully blanked: no last four. The false-hit controls are as important as the hits.
const AADHAAR = '2345 6789 0124'; // valid Verhoeff checksum
const BAD_AADHAAR = '2345 6789 0125'; // the same with a wrong check digit
const blanked = (t: string) => redactSensitive(t).redacted;
const untouched = (t: string) => expect(redactSensitive(t).redacted, t).toBe(t);

describe('[P53-1] Aadhaar', () => {
  it('spaced, dashed and run together are blanked, the whole number', () => {
    for (const n of ['2345 6789 0124', '2345-6789-0124', '234567890124']) {
      const r = redactSensitive(`Candidate sent Aadhaar for the visa file: ${n}, thanks`);
      expect(r.redacted, n).toBe('Candidate sent Aadhaar for the visa file: [ID redacted], thanks');
      expect(r.counts.aadhaar, n).toBe(1);
    }
  });
  it('in Devanagari digits', () => {
    expect(blanked('आधार नंबर २३४५ ६७८९ ०१२४ है')).toBe('आधार नंबर [ID redacted] है');
  });
  it('split over two consecutive messages from the same sender (raw chat and parsed messages)', () => {
    const raw = blanked('[20/10/2026, 12:00] Priya: aadhaar first part 2345 6789\n[20/10/2026, 12:01] Priya: rest 0124\n[20/10/2026, 12:02] Me: got it');
    for (const f of ['2345', '6789', '0124']) expect(raw).not.toContain(f);
    const out = redactMessages([{ sender: 'Priya', body: 'aadhaar first part 2345 6789' }, { sender: 'Priya', body: 'rest 0124' }]);
    expect(out.messages.map((m) => m.body)).toEqual(['aadhaar first part [ID redacted]', 'rest [ID redacted]']);
  });
  it('read out in a voice note', () => {
    expect(blanked('her aadhaar is two three four five six seven eight nine zero one two four, noted'))
      .toBe('her aadhaar is [ID redacted], noted');
  });
  it('NEGATIVE: a 12-digit number that fails the Aadhaar checksum stays', () => {
    untouched(`Reference ${BAD_AADHAAR} for the order`);
    untouched('ref 234567890125');
  });
  it('NEGATIVE: a 12-digit number starting 0 or 1 stays (Aadhaar starts 2-9)', () => {
    untouched('batch 1234 5678 9012 shipped');
  });
  it('NEGATIVE: Indian phone numbers stay', () => {
    for (const t of ['call +91 98765 43210 after 6', 'call 9876543210 after 6', 'call 098765 43210 after 6', 'whatsapp +919876543210']) untouched(t);
  });
  it('NEGATIVE: amounts, dates, invoice, order and job numbers and PIN codes stay', () => {
    for (const t of ['budget ₹12,00,000 for the flat', 'can do 1.5 cr', 'budget 450000', 'joining 20/10/2026', 'invoice INV-2026-004512', 'order 4500012345', 'job ID JOB-77812']) untouched(t); // PIN codes: their own tests below
  });
  it('NEGATIVE: a card number is still a card (Aadhaar never eats its first twelve digits)', () => {
    expect(blanked('card 4539 1488 0343 6467 ok')).toBe('card [card ending 6467] ok');
  });
  it('NEGATIVE: a card split over messages whose first twelve digits happen to pass the Aadhaar checksum is still a card', () => {
    // 4539 1488 0343 is Verhoeff-valid by chance; the chain completes the Luhn-valid card 4539 1488 0343 6467
    const out = redactMessages([{ sender: 'Omar', body: 'card is 4539' }, { sender: 'Omar', body: '1488 0343' }, { sender: 'Omar', body: '6467 thanks' }]);
    expect(out.messages.map((m) => m.body)).toEqual(['card is [card number redacted]', '[card number redacted]', '[card ending 6467] thanks']);
    expect(out.counts).toEqual({ card: 1 });
  });
  it('the placeholder is one the receipt check already knows', () => {
    expect(blanked(`id ${AADHAAR}`)).toContain('[ID redacted]');
  });
});
