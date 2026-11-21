import { describe, it, expect } from 'vitest';
import { mergeWindowExtractions } from './windowed.js';
import type { Extraction, Requirement } from './types.js';
import { currentRequirements, summarizeRequirements } from '../clients/requirement-summary.js';
import { buildBook, NOW, U } from '../../test-support/ask-book.fixture.js';
import { ClientOverviewService } from '../clients/client-overview.js';

/**
 * [P83-8 · owner, 21 Nov] A later requirement that changes a COUNT or LIMIT for the same thing replaces the earlier
 * one: only the latest shows. Accuracy key O02 "We need at least 3 bedrooms" (March) then X01 "ok so update, Karim's
 * mum is definitely moving in now so we need 4 bedrooms not 3" (September). Before this, LATER WINS knew only money
 * slots (rent, price, budget), so "3 bedrooms" and "4 bedrooms" both stayed current.
 */
const O02_RAW = 'We need at least 3 bedrooms';
const X01_RAW = "ok so update, Karim's mum is definitely moving in now so we need 4 bedrooms not 3";
const req = (text: string, raw: string, stated_on: string): Requirement => ({ text, requirement_raw: raw, stated_on, confidence: 'high' });
const ex = (requirements: Requirement[]): Extraction => ({
  summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements, meeting: null,
});
const texts = (e: Extraction) => (e.requirements ?? []).map((r) => r.text);

describe('[P83-8] one import: the later count replaces the earlier one', () => {
  it('O02 then X01, in different pieces of the chat: only "4 bedrooms" stays', () => {
    const merged = mergeWindowExtractions([
      ex([req('At least 3 bedrooms', O02_RAW, '2026-03-02')]),
      ex([req('At least 4 bedrooms', X01_RAW, '2026-09-03')]),
    ]);
    expect(texts(merged)).toEqual(['At least 4 bedrooms']);
    expect(merged.requirements![0]!.requirement_raw).toBe(X01_RAW); // the receipt is verbatim, never edited
  });
  it('the later one says more than the count but names the old value ("not 3"): still replaces it', () => {
    const merged = mergeWindowExtractions([
      ex([req('At least 3 bedrooms', O02_RAW, '2026-03-02')]),
      ex([req("4 bedrooms now that Karim's mum is moving in", X01_RAW, '2026-09-03')]),
    ]);
    expect(texts(merged)).toEqual(["4 bedrooms now that Karim's mum is moving in"]);
  });
  it('within ONE piece too (a chat read in a single pass): the read-time view keeps only the latest', () => {
    const stored = [
      { text: 'At least 3 bedrooms', requirementRaw: O02_RAW, statedOn: '2026-03-02', createdAt: 1 },
      { text: 'At least 4 bedrooms', requirementRaw: X01_RAW, statedOn: '2026-09-03', createdAt: 1 },
    ];
    expect(currentRequirements(stored).map((r) => r.text)).toEqual(['At least 4 bedrooms']);
  });
  it('other count slots: size and parking', () => {
    const merged = mergeWindowExtractions([
      ex([req('Around 2,000 sq ft', 'around 2,000 sq ft', '2026-03-01'), req('1 parking space', 'one parking space is fine', '2026-03-01')]),
      ex([req('At least 2,500 sq ft', 'make it at least 2,500 sq ft', '2026-06-01'), req('2 parking spaces', 'we need 2 parking spaces now', '2026-06-01')]),
    ]);
    expect(texts(merged)).toEqual(['At least 2,500 sq ft', '2 parking spaces']);
  });
});

describe('[P83-8] NEGATIVE: nothing else is dropped', () => {
  it('two different things (3 bedrooms + 2 parking spaces) both stay', () => {
    const merged = mergeWindowExtractions([
      ex([req('At least 3 bedrooms', O02_RAW, '2026-03-02')]),
      ex([req('2 parking spaces', 'and we need 2 parking spaces', '2026-09-03')]),
    ]);
    expect(texts(merged)).toEqual(['At least 3 bedrooms', '2 parking spaces']);
  });
  it('a later count for a DIFFERENT property leaves the earlier need alone', () => {
    const merged = mergeWindowExtractions([
      ex([req('At least 3 bedrooms', O02_RAW, '2026-03-02')]),
      ex([req('2BR apartment for her mother in JLT', 'also a 2BR apartment for my mother in JLT', '2026-09-03')]),
    ]);
    expect(texts(merged)).toEqual(['At least 3 bedrooms', '2BR apartment for her mother in JLT']);
  });
  it('an earlier need that says more than the count (a villa in Mirdif) is never dropped by a later count', () => {
    const merged = mergeWindowExtractions([
      ex([req('3 bedroom villa in Mirdif', 'a 3 bedroom villa in Mirdif', '2026-03-02')]),
      ex([req('At least 4 bedrooms', X01_RAW, '2026-09-03')]),
    ]);
    expect(texts(merged)).toEqual(['3 bedroom villa in Mirdif', 'At least 4 bedrooms']);
  });
  it('an earlier need with two counts (bedrooms AND parking) is not dropped by a later bedroom count', () => {
    const merged = mergeWindowExtractions([
      ex([req('3 bedrooms and 2 parking spaces', 'we need 3 bedrooms and 2 parking spaces', '2026-03-02')]),
      ex([req('At least 4 bedrooms', X01_RAW, '2026-09-03')]),
    ]);
    expect(texts(merged)).toEqual(['3 bedrooms and 2 parking spaces', 'At least 4 bedrooms']);
  });
  it('a later mention repeating the same value drops nothing', () => {
    const merged = mergeWindowExtractions([
      ex([req('At least 3 bedrooms', O02_RAW, '2026-03-02')]),
      ex([req('3 bedrooms minimum', 'still 3 bedrooms minimum', '2026-09-03')]),
    ]);
    expect(texts(merged)).toEqual(['At least 3 bedrooms', '3 bedrooms minimum']);
  });
  it('an earlier count is never replaced by an EARLIER one (order decides, not position in the list)', () => {
    const stored = [
      { text: 'At least 4 bedrooms', requirementRaw: X01_RAW, statedOn: '2026-09-03', createdAt: 2 },
      { text: 'At least 3 bedrooms', requirementRaw: O02_RAW, statedOn: '2026-03-02', createdAt: 1 },
    ];
    expect(currentRequirements(stored).map((r) => r.text)).toEqual(['At least 4 bedrooms']);
  });
  it('the budget rule is unchanged (a budget is not a count slot here)', () => {
    const merged = mergeWindowExtractions([
      ex([req('budget around 3M', 'budget around 3M', '2026-03-02')]),
      ex([req('Updated budget of 3.4M', 'our budget is now 3.4M', '2026-05-16')]),
    ]);
    expect(texts(merged)).toEqual(['Updated budget of 3.4M']);
  });
});

describe('[P83-8] across separate notes: the client page shows only the latest', () => {
  it('O02 in one import and X01 in a later one: wants and the Clients list read 4BR, the 3-bedroom need is not listed', async () => {
    const b = await buildBook();
    const c = await b.repos.clients.create(U, 'QA Karim Family');
    const n1 = await b.repos.notes.create(U, { clientId: c.id, source: 'whatsapp_export', rawText: O02_RAW, audioKey: null, status: 'extracted', messages: [] });
    const n2 = await b.repos.notes.create(U, { clientId: c.id, source: 'paste', rawText: X01_RAW, audioKey: null, status: 'extracted', messages: [] });
    await b.repos.requirements.saveForNote(U, n1.id, c.id, [{ text: 'At least 3 bedrooms', requirementRaw: O02_RAW, statedOn: '2026-03-02', confidence: 'high', embedding: null }]);
    await b.repos.requirements.saveForNote(U, n2.id, c.id, [{ text: 'At least 4 bedrooms', requirementRaw: X01_RAW, statedOn: '2026-09-03', confidence: 'high', embedding: null }]);
    const svc = new ClientOverviewService({ ...b.repos, coldThresholdDays: 30 });
    const o = (await svc.forClient(U, c.id, NOW))!;
    expect(o.wants.items.map((i) => i.text)).toEqual(['At least 4 bedrooms']);
    expect(o.wants.summary).toBe('4BR');
    const rows = await svc.rowSummaries(U, NOW);
    expect(rows[c.id]!.listLine).toBe('4BR');
    // nothing is deleted: the earlier need is still stored (it stays in the chat and the record)
    expect((await b.repos.requirements.listByClient(U, c.id)).length).toBe(2);
  });
  it('NEGATIVE: summarizeRequirements on its own is unchanged (it still reads what it is given)', () => {
    const s = summarizeRequirements([{ text: '4BR villa in Mirdif', requirementRaw: 'a 4BR villa in Mirdif', statedOn: '2026-05-01', createdAt: 1 }]);
    expect(s.listLine).toBe('4BR Villa · Mirdif');
  });
});
