import { describe, it, expect } from 'vitest';
import { buildBook, NOW, U } from '../../test-support/ask-book.fixture.js';

/**
 * [P35-1] Phone test, 20 Oct: "How many clients do I have with open requirements?" answered "I don't have that on
 * record" (the account has several). Count and list questions across clients are answered from the STRUCTURED
 * tables — deterministic, no model call — with the count first, one line per client, each with its receipt;
 * over 10 → the first 10 and "and N more"; zero is an answer; the listed clients scope a follow-up.
 * Open requirement = ≥ 1 stored requirement with status 'open', client not closed (won / lost_confirmed /
 * lead status done).
 */
describe('[P35-1] count & list questions across clients', () => {
  it('"How many clients do I have with open requirements?" → 3 clients, the right 3, each with a receipt; no model call', async () => {
    const b = await buildBook();
    const out = await b.svc.ask(U, 'How many clients do I have with open requirements?', NOW);
    expect(out.answer.split('\n')[0]).toBe('3 clients have open requirements:');
    expect(out.list!.count).toBe(3);
    expect(out.list!.items.map((i) => i.clientName).sort()).toEqual(['QA Enter Key Client', 'QA P14 Gate Client', 'QA Windowed Buyer 2']);
    const gate = out.list!.items.find((i) => i.clientName === 'QA P14 Gate Client')!;
    expect(gate.line).toBe('2BR in JVC, budget around 1.5M, parking for two cars');
    expect(gate.receipts.length).toBeGreaterThan(0);
    expect(gate.receipts[0]).toMatchObject({ clientId: b.ids.gate, quote: 'looking for a 2BR in JVC' });
    expect(out.answer).not.toMatch(/QA Closed Client/);
    expect(out.answer).toContain('QA P14 Gate Client: 2BR in JVC, budget around 1.5M, parking for two cars');
    expect(b.modelCalls()).toBe(0);
  });

  it('Arabic: "كم عدد العملاء الذين لديهم متطلبات مفتوحة؟" → 3', async () => {
    const b = await buildBook();
    const out = await b.svc.ask(U, 'كم عدد العملاء الذين لديهم متطلبات مفتوحة؟', NOW);
    expect(out.list!.count).toBe(3);
  });

  it('"how many clients do I have" → the total from the database', async () => {
    const b = await buildBook();
    const out = await b.svc.ask(U, 'how many clients do I have', NOW);
    expect(out.answer.split('\n')[0]).toBe('You have 5 clients:');
    expect(out.list!.count).toBe(5);
  });

  it('a budget filter: "Which clients have a budget over 2M?" → Windowed (3.4M, the latest) and Enter Key (2.2M), not Gate (1.5M)', async () => {
    const b = await buildBook();
    const out = await b.svc.ask(U, 'Which clients have a budget over 2M?', NOW);
    expect(out.list!.items.map((i) => i.clientName).sort()).toEqual(['QA Enter Key Client', 'QA Windowed Buyer 2']);
    expect(b.modelCalls()).toBe(0);
  });

  it('a property-type filter: "Who wants a villa?" → QA Windowed Buyer 2', async () => {
    const b = await buildBook();
    const out = await b.svc.ask(U, 'Who wants a villa?', NOW);
    expect(out.list!.items.map((i) => i.clientName)).toEqual(['QA Windowed Buyer 2']);
  });

  it('an area filter: "Which clients are looking in JVC?" → QA P14 Gate Client', async () => {
    const b = await buildBook();
    const out = await b.svc.ask(U, 'Which clients are looking in JVC?', NOW);
    expect(out.list!.items.map((i) => i.clientName)).toEqual(['QA P14 Gate Client']);
  });

  it('follow-up: after the count, "which of them need parking?" → QA P14 Gate Client only', async () => {
    const b = await buildBook();
    await b.svc.ask(U, 'How many clients do I have with open requirements?', NOW);
    const out = await b.svc.ask(U, 'which of them need parking?', NOW + 60_000);
    expect(out.list!.items.map((i) => i.clientName)).toEqual(['QA P14 Gate Client']);
    expect(out.list!.items[0]!.receipts[0]!.quote).toBe('We need parking for two cars');
  });

  it('zero is an answer: a book with no requirements → "None of your clients have open requirements right now."', async () => {
    const b = await buildBook({ empty: true });
    const out = await b.svc.ask(U, 'How many clients do I have with open requirements?', NOW);
    expect(out.answer).toBe('None of your clients have open requirements right now.');
    expect(out.answer).not.toMatch(/on record/i);
    expect(out.list!.count).toBe(0);
  });

  it('over 10 clients → the first 10 lines and "and N more"', async () => {
    const b = await buildBook({ extraClients: 12 });
    const out = await b.svc.ask(U, 'Which clients have open requirements?', NOW);
    expect(out.list!.count).toBe(15);
    expect(out.list!.items).toHaveLength(10);
    expect(out.list!.more).toBe(5);
    expect(out.answer.trim().split('\n').at(-1)).toBe('…and 5 more.');
  });

  it('NEGATIVE: a question that is not a count/list across clients falls through to the normal path', async () => {
    const b = await buildBook();
    const out = await b.svc.ask(U, 'What did Gate say about the floor plans?', NOW);
    expect(out.list).toBeUndefined();
  });
});
