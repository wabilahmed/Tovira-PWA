import { describe, it, expect } from 'vitest';
import { buildBook, NOW, U } from '../../test-support/ask-book.fixture.js';

/**
 * [P35-4] The rest of Ask, checked for the same failure ("I don't have that on record" when the data exists).
 * The six questions from the phone review, on the test-rep-shaped book (NOW = Tue 20 Oct 2026). Each is answered
 * from the structured tables, deterministically, with no model call — and none may say "I don't have that".
 */
const ask = async (q: string) => {
  const b = await buildBook();
  const out = await b.svc.ask(U, q, NOW);
  expect(out.answer).not.toMatch(/don't have that on record/i);
  expect(b.modelCalls()).toBe(0);
  return out;
};
const names = (out: Awaited<ReturnType<typeof ask>>) => out.list!.items.map((i) => i.clientName);

describe('[P35-4] the Ask sweep', () => {
  it('"How many clients do I have?" → 5', async () => {
    const out = await ask('How many clients do I have?');
    expect(out.answer.split('\n')[0]).toBe('You have 5 clients:');
  });

  it('"Which clients haven\'t replied in 2 weeks?" → Enter Key (1 Sep) and Quiet (20 Sep); the won client is left out', async () => {
    const out = await ask("Which clients haven't replied in 2 weeks?");
    expect(names(out).sort()).toEqual(['QA Enter Key Client', 'QA Quiet Client']);
    expect(out.answer.split('\n')[0]).toBe("2 clients haven't replied in 2 weeks:");
    const ek = out.list!.items.find((i) => i.clientName === 'QA Enter Key Client')!;
    expect(ek.line).toBe('last replied 1 Sep 2026');
    expect(ek.receipts[0]).toMatchObject({ quote: 'A 3BR townhouse in Arabian Ranches, budget 2.2M', date: '2026-09-01' });
  });

  it('"Who wants a villa?" → QA Windowed Buyer 2', async () => {
    expect(names(await ask('Who wants a villa?'))).toEqual(['QA Windowed Buyer 2']);
  });

  it('"Which clients have a budget over 2M?" → Windowed (3.4M) and Enter Key (2.2M)', async () => {
    expect(names(await ask('Which clients have a budget over 2M?')).sort()).toEqual(['QA Enter Key Client', 'QA Windowed Buyer 2']);
  });

  it('"What have I promised this week?" → the payment plan for Enter Key (made 19 Oct); not the client\'s promise', async () => {
    const out = await ask('What have I promised this week?');
    expect(out.answer.split('\n')[0]).toBe('You promised 1 thing this week:');
    expect(out.list!.items).toHaveLength(1);
    expect(out.list!.items[0]).toMatchObject({ clientName: 'QA Enter Key Client', line: 'you promised to send the payment plan · due 27 Oct 2026' });
    expect(out.list!.items[0]!.receipts[0]!.quote).toBe("I'll send the payment plan next week");
  });

  it('"How many promises are overdue?" → 2: the floor plans (yours) and the ID photos (the client\'s)', async () => {
    const out = await ask('How many promises are overdue?');
    expect(out.answer.split('\n')[0]).toBe('2 promises are overdue:');
    expect(out.list!.items.map((i) => `${i.clientName} — ${i.line}`).sort()).toEqual([
      'QA P14 Gate Client — you promised to send the floor plans · due 18 Oct 2026',
      'QA Windowed Buyer 2 — promised to send the ID document photos · due 15 Oct 2026',
    ]);
  });

  it('zero is an answer for promises too', async () => {
    const b = await buildBook();
    const out = await b.svc.ask(U, 'How many promises are overdue?', Date.parse('2026-10-10T08:00:00Z'));
    expect(out.answer).toBe('No promises are overdue right now.');
  });
});

describe('[P35-4] headlines read the way the rep asked', () => {
  it('type, budget and content-word filters each get a plain headline, in the rep\'s own words', async () => {
    expect((await ask('Who wants a villa?')).answer.split('\n')[0]).toBe('1 client wants a villa:');
    expect((await ask('Which clients have a budget over 2M?')).answer.split('\n')[0]).toBe('2 clients have a budget over 2M:');
    expect((await ask('Which clients need parking?')).answer.split('\n')[0]).toBe('1 client mentions parking:');
  });
});
