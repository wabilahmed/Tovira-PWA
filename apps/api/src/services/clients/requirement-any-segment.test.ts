import { describe, it, expect } from 'vitest';
import { summarizeRequirements, requirementFacets } from './requirement-summary.js';

/**
 * [P42-B4] Owner: the "What they want" line fits every relationship-sales rep. Property keeps its format
 * ("3BR Villa · Arabian Ranches · ~AED 4.5M"). Any other need is read from the requirement's own stored text: what
 * they need, then its timing and budget as the text states them. Always ONE requirement, "+N more" for the rest
 * (the P40 rule), and never empty when a requirement exists. Nothing is added that the text does not say.
 */
const req = (text: string, statedOn: string, raw = text) => ({ text, requirementRaw: raw, statedOn, createdAt: Date.parse(statedOn) });

describe('[P42-B4] the wants line for any segment', () => {
  it('property keeps its format', () => {
    const s = summarizeRequirements([req('A 3-bed villa in Arabian Ranches (budget around 4.5 million)', '2026-07-09', 'looking for a 3-bed villa in Arabian Ranches, budget around 4.5 million')]);
    expect(s.listLine).toBe('3BR Villa · Arabian Ranches · ~AED 4.5M');
  });

  it('insurance: the need, then its renewal month', () => {
    const s = summarizeRequirements([req('Motor and medical cover renewing in June', '2026-01-20', 'renewal is in June, want motor and medical together')]);
    expect(s.listLine).toBe('Motor and medical cover · renewal Jun');
    expect(s.summary).toBe('Motor and medical cover · renewal Jun');
  });

  it('B2B: the need, then the date it is tied to', () => {
    const s = summarizeRequirements([req('Revised SLA before the board meets on 14 Apr', '2026-04-08', 'procurement wants the revised SLA before the board meets on the 14th')]);
    expect(s.listLine).toBe('Revised SLA · board meets 14 Apr');
  });

  it('free text only: the need as stated, without its leading article', () => {
    expect(summarizeRequirements([req('An introduction to their new CFO', '2026-03-01')]).listLine).toBe('Introduction to their new CFO');
  });

  it('a stated amount is shown the same way as a property budget', () => {
    expect(summarizeRequirements([req('Executive role in Abu Dhabi, package around 80K a month', '2026-01-12')]).listLine).toBe('Executive role in Abu Dhabi · ~AED 80K');
  });

  it('one requirement plus "+N more", never two stitched together', () => {
    const s = summarizeRequirements([req('Motor and medical cover renewing in June', '2026-01-20'), req('Revised SLA before the board meets on 14 Apr', '2026-04-08')]);
    expect(s.listLine).toBe('Revised SLA · board meets 14 Apr · +1 more');
  });

  it('a long need is cut at a word, never mid-word', () => {
    const line = summarizeRequirements([req('A full review of the group medical scheme for all three subsidiaries and their dependants', '2026-02-01')]).listLine!;
    expect(line).toBe('Full review of the group medical scheme for all…');
  });

  it('NEGATIVE: never empty when a requirement exists (list line and client-page summary)', () => {
    for (const text of ['Motor cover', 'Something', 'Budget around 20K', 'A 3-bed', 'An emerald set']) {
      const s = summarizeRequirements([req(text, '2026-02-17')]);
      expect(s.listLine, text).toBeTruthy();
      expect(s.summary, text).toBeTruthy();
    }
  });

  it('NEGATIVE: a month is never read as an area, and a non-property need has no property facets', () => {
    expect(requirementFacets([req('Motor and medical cover renewing in June', '2026-01-20')])).toMatchObject({ beds: null, type: null, area: null });
    expect(requirementFacets([req('Renewal in Q3', '2026-01-20')]).area).toBeNull();
  });
});
