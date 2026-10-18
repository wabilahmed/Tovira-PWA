import { describe, it, expect } from 'vitest';
import { isMeetingNotPromise } from './meeting-like.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { StructuredRecall } from '../recall/structured-recall.js';
import { BookScanService } from '../book-scan/book-scan-service.js';

/** [P21-R3] A confirmed meeting the extractor also stored as a promise ("Confirmed viewing on 25/04/2026 at
 *  11am") is listed under "You promised". Meetings stay out of every promise list; the row is still kept
 *  (and still exported). The rule is tight — a real promise that merely mentions a call/meeting stays. */
describe('[P21-R3] isMeetingNotPromise', () => {
  for (const t of ['Confirmed viewing on 25/04/2026 at 11am', 'confirmed the viewing for Saturday 11am', 'Scheduled a site visit on Thursday at 4pm', 'Booked a meeting at 3pm tomorrow', 'Viewing on 25/04/2026 at 11am', 'Site visit at 10am Friday', 'Appointment on 12/04/2026 at 3pm']) {
    it(`meeting: "${t}"`, () => expect(isMeetingNotPromise(t)).toBe(true));
  }
  for (const t of ['Send three villa options', 'call back about the 2-bed', 'Send the meeting notes by Monday', 'Arrange a viewing for Sara', 'Share the floor plans before the viewing', 'Confirm the viewing time with the landlord', 'follow up after the meeting on Thursday']) {
    it(`NEGATIVE — still a promise: "${t}"`, () => expect(isMeetingNotPromise(t)).toBe(false));
  }
});

describe('[P21-R3] meetings stay out of promise lists', () => {
  async function seed() {
    const facts = new InMemoryFactsRepository();
    const clients = new InMemoryClientRepository();
    const c = await clients.create('u', 'QA Sara Khan');
    await facts.saveExtraction('u', { noteId: 'n1', clientId: c.id, promises: [
      { text: 'Confirmed viewing on 25/04/2026 at 11am', owner: 'rep', due_date: '2026-04-25', due_raw: '25/04/2026 at 11am', confidence: 'high' },
      { text: 'Send three villa options', owner: 'rep', due_date: '2026-04-20', due_raw: null, confidence: 'high' },
    ] });
    return { facts, clients };
  }

  it('listPromisesByUser leaves the meeting out; the export (includeDeleted) still carries it', async () => {
    const { facts } = await seed();
    expect((await facts.listPromisesByUser('u')).map((p) => p.text)).toEqual(['Send three villa options']);
    expect((await facts.listPromisesByUser('u', { includeDeleted: true })).map((p) => p.text).sort()).toEqual(['Confirmed viewing on 25/04/2026 at 11am', 'Send three villa options']);
  });

  it('Ask never says "you promised to Confirmed viewing…"', async () => {
    const { facts, clients } = await seed();
    const r = await new StructuredRecall({ facts, clients, meetings: new InMemoryMeetingRepository() }).forUser('u', Date.parse('2026-04-18T00:00:00Z'), { question: 'what have I promised?' });
    expect(r.map((x) => x.quote).join('|')).not.toMatch(/promised to Confirmed viewing/i);
    expect(r.some((x) => x.quote.includes('you promised to Send three villa options'))).toBe(true);
  });

  it('Book Scan does not list it as an open promise', async () => {
    const { facts, clients } = await seed();
    const report = await new BookScanService({ clients, notes: new InMemoryNoteRepository(), facts }, { coldThresholdDays: 30, upcomingWindowDays: 30, promiseStaleThresholdDays: 400 }).scan('u', Date.parse('2026-04-18T00:00:00Z'));
    expect(report.items.filter((i) => i.kind === 'open_promise').map((i) => i.receipt.quote)).toEqual(['Send three villa options']);
  });
});
