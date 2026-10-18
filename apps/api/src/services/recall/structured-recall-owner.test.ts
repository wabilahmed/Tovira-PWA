import { describe, it, expect, beforeEach } from 'vitest';
import { StructuredRecall } from './structured-recall.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';

/**
 * [P21-A4] The structured source carries the promise OWNER. A client's promise reads
 * "QA P14 Gate Client promised to …" (never "you promised to …"), and a question about YOUR promises
 * leaves the client-owned ones out.
 */
const USER = 'u-a4';
const NOW = Date.parse('2026-10-18T09:00:00Z');
let structured: StructuredRecall;
let gateId: string;

beforeEach(async () => {
  const clients = new InMemoryClientRepository();
  const facts = new InMemoryFactsRepository();
  structured = new StructuredRecall({ facts, meetings: new InMemoryMeetingRepository(), clients });
  const gate = await clients.create(USER, 'QA P14 Gate Client');
  const sara = await clients.create(USER, 'QA Sara Khan');
  gateId = gate.id;
  await facts.saveExtraction(USER, { noteId: 'n1', clientId: gate.id, promises: [
    { text: 'send the signed contract', owner: 'client', due_date: '2026-10-21', due_raw: null, confidence: 'high' },
    { text: 'send three villa options', owner: 'rep', due_date: '2026-10-20', due_raw: null, confidence: 'high' },
  ] });
  await facts.saveExtraction(USER, { noteId: 'n2', clientId: sara.id, promises: [{ text: 'share the floor plans', owner: 'rep', due_date: '2026-10-25', due_raw: null, confidence: 'high' }] });
});

const quotes = async (question?: string) => (await structured.forUser(USER, NOW, question ? { question } : {})).map((r) => r.quote);

describe('[P21-A4] promise owner in Ask', () => {
  it('a client-owned promise is phrased as the client\'s', async () => {
    const q = await quotes();
    expect(q).toContain('QA P14 Gate Client promised to send the signed contract');
    expect(q.some((x) => x.includes('you promised to send the signed contract'))).toBe(false);
    expect(q).toContain('QA P14 Gate Client — you promised to send three villa options');
  });

  for (const ask of ['What have I promised?', 'What did I promise and to whom?', 'my promises this week', "What do I owe clients?", 'Which clients have I promised to send options to?', 'شو وعدت العملاء؟']) {
    it(`"${ask}" excludes client-owned promises`, async () => {
      const q = await quotes(ask);
      expect(q.some((x) => x.includes('send the signed contract'))).toBe(false);
      expect(q.some((x) => x.includes('you promised to'))).toBe(true);
    });
  }

  it('NEGATIVE: a question about what the CLIENT promised still gets the client-owned promise', async () => {
    const r = await structured.forUser(USER, NOW, { question: 'What did QA P14 Gate Client promise to send?' });
    expect(r.some((x) => x.clientId === gateId && x.quote === 'QA P14 Gate Client promised to send the signed contract')).toBe(true);
  });
});
