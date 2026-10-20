import { describe, it, expect } from 'vitest';
import { buildBook, NOW, U } from '../../test-support/ask-book.fixture.js';

/**
 * [P35-1c] The count path must not swallow questions it can't answer:
 *  - a question that names a specific client is about THAT client — it takes the normal Ask path, never a count;
 *  - a count that would come out zero first lets the normal path try; "None of your clients…" only when that
 *    also finds nothing.
 */
describe('[P35-1c] when the count path steps aside', () => {
  for (const q of ["Who is Sara's decision-maker?", 'Which villa did QA Windowed Buyer 2 like?', "Who's the agent on the Palm deal?"]) {
    it(`"${q}" never gets a count answer`, async () => {
      const b = await buildBook();
      const out = await b.svc.ask(U, q, NOW);
      expect(out.list).toBeUndefined();
      expect(out.answer).not.toMatch(/^(None of your clients|\d+ clients? )/);
    });
  }

  it('"How many clients want a penthouse?" with none (and nothing elsewhere) still answers zero', async () => {
    const b = await buildBook();
    const out = await b.svc.ask(U, 'How many clients want a penthouse?', NOW);
    expect(out.answer).toBe('None of your clients want a penthouse right now.');
    expect(out.list!.count).toBe(0);
    expect(out.receipts).toEqual([]);
  });

  it('a zero count yields to the normal path when that finds something', async () => {
    const b = await buildBook({ modelAnswer: 'QA Enter Key Client asked about a penthouse in Marina last spring.' });
    const out = await b.svc.ask(U, 'How many clients want a penthouse?', NOW);
    expect(out.answer).toBe('QA Enter Key Client asked about a penthouse in Marina last spring.');
    expect(out.list).toBeUndefined();
  });

  it('NEGATIVE: a non-zero count is still answered by the count path (no model call)', async () => {
    const b = await buildBook({ modelAnswer: 'should not be used' });
    const out = await b.svc.ask(U, 'How many clients do I have with open requirements?', NOW);
    expect(out.list!.count).toBe(3);
    expect(b.modelCalls()).toBe(0);
  });

  // A book where nothing about the question is on record: the only difference is whether "Abu Khalid" is a
  // learned alias of a client. With it, the question is about that client → the honest not-found, never
  // "None of your clients match … Abu, Khalid".
  const q = 'Which villa did Abu Khalid like?';
  it('a client named by a learned alias is about that client — the normal path, not a count', async () => {
    const b = await buildBook({ empty: true, aliases: { 'QA Windowed Buyer 2': ['Abu Khalid'] } });
    const out = await b.svc.ask(U, q, NOW);
    expect(out.list).toBeUndefined();
    expect(out.answer).toBe("I don't have that on record.");
  });

  it('NEGATIVE: the same question with no such alias, and nothing found, is still the count-path zero', async () => {
    const b = await buildBook({ empty: true });
    const out = await b.svc.ask(U, q, NOW);
    expect(out.list!.count).toBe(0);
    expect(out.answer).toMatch(/^None of your clients/);
  });
});
