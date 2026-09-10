import { describe, it, expect } from 'vitest';
import { redactTier2 } from './tier2.js';

// [TIER2-INPUT] Anchored, precision-first. These tests pin BOTH sides: the anchored special-category
// phrases are removed, and ambiguous business language that merely resembles them is left intact.

describe('[TIER2-INPUT] removes anchored special-category content', () => {
  const cases: Array<[string, string]> = [
    ['The buyer was diagnosed with cancer last month, deal on hold.', 'health'],
    ['Contact has diabetes so travels less.', 'health'],
    ['He is on insulin now.', 'health'],
    ['She is undergoing chemotherapy, reschedule Q3.', 'health'],
    ['The MD is a devout Muslim, avoid Friday afternoons.', 'religion'],
    ['Their founder is gay and mentioned it openly.', 'orientation'],
    ['The partner was convicted of fraud in 2019.', 'criminal'],
  ];
  for (const [text, kind] of cases) {
    it(`removes: "${text}"`, () => {
      const r = redactTier2(text);
      expect(r.total).toBeGreaterThan(0);
      expect(r.counts[kind as keyof typeof r.counts]).toBeGreaterThan(0);
      expect(r.redacted).toContain('removed]');
    });
  }

  it('preserves the surrounding legitimate context (removes the detail, not the sentence)', () => {
    const r = redactTier2('The buyer was diagnosed with cancer, so push the demo to March.');
    expect(r.redacted).toContain('push the demo to March');
    expect(r.redacted).not.toContain('cancer');
  });

  it('is idempotent — a second pass changes nothing', () => {
    const once = redactTier2('Client has HIV and wants the report Friday.').redacted;
    const twice = redactTier2(once).redacted;
    expect(twice).toBe(once);
  });
});

describe('[TIER2-INPUT] false-positive guard — ambiguous business language is untouched', () => {
  const untouched = [
    'That was a smooth operation and a healthy margin.',
    "I'm sick of the delays; cancel the Tuesday call.",
    'The party is next Thursday at their office.',
    'We had a heart-to-heart about the contract.',
    'Their Christian name is on the invoice.',
    'The deal is terminal-stage in the pipeline sense — nearly closed.',
    'Ship the order to the hospital procurement team.',
  ];
  for (const text of untouched) {
    it(`leaves untouched: "${text}"`, () => {
      const r = redactTier2(text);
      expect(r.total).toBe(0);
      expect(r.redacted).toBe(text);
    });
  }
});
