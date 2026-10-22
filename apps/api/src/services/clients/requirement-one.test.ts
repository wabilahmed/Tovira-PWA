import { describe, it, expect } from 'vitest';
import { summarizeRequirements, requirementFacets } from './requirement-summary.js';

/**
 * [P40-5] The wants line comes from ONE requirement — never fields stitched across two. "QA Ahmed Al Mansouri" showed
 * "1BR Villa" from "a 1 bed flat for my son near his university" + "a 3 bedroom villa in Arabian Ranches, budget
 * around 4.5M". The line now reads the most recent open requirement that names what they want, plus "+N more".
 */
const req = (raw: string, statedOn: string, text = raw) => ({ text, requirementRaw: raw, statedOn, createdAt: Date.parse(statedOn) });
const AHMED = [
  req('I need a 1 bed flat for my son near his university', '2026-09-01'),
  req("I'm looking for a 3 bedroom villa in Arabian Ranches, budget around 4.5M", '2026-09-10'),
];

describe('[P40-5] one requirement per summary', () => {
  it('the exact pair → "3BR Villa · Arabian Ranches · ~AED 4.5M · +1 more"', () => {
    expect(summarizeRequirements(AHMED).listLine).toBe('3BR Villa · Arabian Ranches · ~AED 4.5M · +1 more');
  });

  it('negative: never "1BR Villa" — bedrooms and type never come from different requirements', () => {
    const s = summarizeRequirements(AHMED);
    expect(s.listLine).not.toMatch(/1BR Villa/);
    expect(s.summary).not.toMatch(/1BR Villa/);
  });

  // With ONE property need, a later budget-only message can only be that need's budget (the 20 Oct rule: the latest
  // budget sets the wording) — so it updates the budget and is not a "+1 more". With two or more needs it is never
  // attached to either (see the next test).
  it('one need + a later budget-only update → that need with the new budget, no "+1 more"', () => {
    const s = summarizeRequirements([req('looking for a 4BR villa in Mirdif, budget around 3M', '2026-05-01', '4BR villa in Mirdif'), req('max budget is 3.4M', '2026-05-16', 'Max budget of 3.4M')]);
    expect(s.listLine).toBe('4BR Villa · Mirdif · up to AED 3.4M');
    expect(s.budgets).toEqual(['3M', '3.4M']); // the labelled budget history still shows both
  });

  it('negative: two needs + a later budget-only message → never attached to either', () => {
    const s = summarizeRequirements([...AHMED, req('budget is now 5M', '2026-09-20')]);
    expect(s.listLine).toBe('3BR Villa · Arabian Ranches · ~AED 4.5M · +2 more');
  });

  it('a single requirement has no "+N more"; a flat is an Apartment', () => {
    expect(summarizeRequirements([AHMED[0]!]).listLine).toBe('1BR Apartment');
  });

  it('requirementFacets reads one requirement at a time', () => {
    expect(requirementFacets([AHMED[0]!])).toMatchObject({ beds: '1BR', type: 'Apartment', area: null });
    expect(requirementFacets([AHMED[1]!])).toMatchObject({ beds: '3BR', type: 'Villa', area: 'Arabian Ranches', budgets: ['4.5M'] });
  });
});
