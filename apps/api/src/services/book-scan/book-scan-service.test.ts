import { describe, it, expect, beforeEach } from 'vitest';
import { BookScanService } from './book-scan-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';

const DAY = 24 * 60 * 60 * 1000;
const USER = 'user-1';

let clients: InMemoryClientRepository;
let notes: InMemoryNoteRepository;
let facts: InMemoryFactsRepository;
let scan: BookScanService;

beforeEach(() => {
  clients = new InMemoryClientRepository();
  notes = new InMemoryNoteRepository();
  facts = new InMemoryFactsRepository();
  scan = new BookScanService({ clients, notes, facts }, { coldThresholdDays: 30, upcomingWindowDays: 30 });
});

describe('BookScanService (P5-3b)', () => {
  it('reveals an open promise with its receipt, framed as worth checking', async () => {
    const c = await clients.create(USER, 'Acme');
    await facts.saveExtraction(USER, {
      noteId: 'n1',
      clientId: c.id,
      promises: [{ text: 'send the revised quote', owner: 'rep', due_date: '2026-08-01', due_raw: 'Friday', confidence: 'high' }],
    });

    const report = await scan.scan(USER, Date.parse('2026-07-15T00:00:00Z'));
    const promise = report.items.find((i) => i.kind === 'open_promise')!;
    expect(promise).toBeTruthy();
    expect(promise.receipt.quote).toContain('revised quote');
    expect(promise.receipt.date).toBe('2026-08-01');
    expect(promise.framing).toBe('worth_checking'); // never "you never did this"
  });

  it('reveals an unanswered client question, quoting it', async () => {
    const c = await clients.create(USER, 'Sara Lee');
    const note = await notes.create(USER, { clientId: c.id, source: 'whatsapp_export', rawText: 'thread', audioKey: null, status: 'extracted' });
    await notes.update(USER, note.id, {
      extracted: { unanswered_questions: [{ question: 'Can you do bulk pricing?', sentAt: '2026-01-16T10:00:00', sender: 'Sara Lee' }] },
    });

    const report = await scan.scan(USER, Date.parse('2026-07-15T00:00:00Z'));
    const q = report.items.find((i) => i.kind === 'unanswered_question')!;
    expect(q).toBeTruthy();
    expect(q.receipt.quote).toBe('Can you do bulk pricing?');
    expect(q.receipt.date).toBe('2026-01-16T10:00:00');
  });

  it('reveals a going-cold client and an upcoming date', async () => {
    const cold = await clients.create(USER, 'Quiet Co');
    await notes.create(USER, { clientId: cold.id, source: 'paste', rawText: 'last thing we discussed was the pilot', audioKey: null, status: 'extracted' });
    await facts.saveExtraction(USER, {
      noteId: 'n2',
      clientId: cold.id,
      promises: [],
      keyDates: [{ description: "founder's birthday", date: '2026-07-20', date_raw: 'the 20th', type: 'birthday' }],
    });

    // 100 days later: the client (touched ~now) is well past the 30-day cold line,
    // and the birthday is inside the 30-day upcoming window.
    const report = await scan.scan(USER, Date.now() + 100 * DAY);
    // Upcoming date is relative to real "now" in the seed, so assert cold here and
    // upcoming-date logic separately below with a fixed clock.
    expect(report.items.some((i) => i.kind === 'going_cold' && i.clientId === cold.id)).toBe(true);
  });

  it('includes an upcoming date within the window and excludes past/far ones', async () => {
    const c = await clients.create(USER, 'Acme');
    await facts.saveExtraction(USER, {
      noteId: 'n3',
      clientId: c.id,
      promises: [],
      keyDates: [
        { description: 'launch', date: '2026-07-20', date_raw: null, type: 'launch' }, // within 30d of Jul 15
        { description: 'old anniversary', date: '2026-01-01', date_raw: null, type: 'anniversary' }, // past
        { description: 'far deadline', date: '2027-01-01', date_raw: null, type: 'deadline' }, // far future
      ],
    });
    const report = await scan.scan(USER, Date.parse('2026-07-15T00:00:00Z'));
    const upcoming = report.items.filter((i) => i.kind === 'upcoming_date');
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]!.receipt.quote).toContain('launch');
  });

  // TRUST RULE: every rendered item carries a receipt (quote + date). No exceptions.
  it('never renders an item without a receipt (quote + date)', async () => {
    const c = await clients.create(USER, 'Acme');
    await facts.saveExtraction(USER, {
      noteId: 'n4',
      clientId: c.id,
      promises: [{ text: 'send deck', owner: 'rep', due_date: null, due_raw: 'soon', confidence: 'high' }], // no due date
      keyDates: [{ description: 'launch', date: '2026-07-20', date_raw: null, type: 'launch' }],
    });
    const note = await notes.create(USER, { clientId: c.id, source: 'whatsapp_export', rawText: 't', audioKey: null, status: 'extracted' });
    await notes.update(USER, note.id, { extracted: { unanswered_questions: [{ question: 'pricing?', sentAt: null, sender: 'Acme' }] } });

    const report = await scan.scan(USER, Date.parse('2026-07-15T00:00:00Z'));
    expect(report.items.length).toBeGreaterThan(0);
    for (const item of report.items) {
      expect(item.receipt.quote.trim().length).toBeGreaterThan(0);
      expect(item.receipt.date).toBeTruthy(); // a promise with no due date still gets a fallback date
    }
  });

  // TRUST RULE: a thin/empty seed gets an honest empty state, never fabrications.
  it('returns an honest empty state when there is nothing to reveal', async () => {
    await clients.create(USER, 'Fresh Client'); // client exists but no facts/notes
    const report = await scan.scan(USER, Date.parse('2026-07-15T00:00:00Z'));
    expect(report.items).toEqual([]);
    expect(report.isEmpty).toBe(true);
    expect(report.message).toMatch(/not much here yet|export/i);
  });

  it('always ends with an invitation to export the next chat', async () => {
    await clients.create(USER, 'Acme');
    const report = await scan.scan(USER, Date.parse('2026-07-15T00:00:00Z'));
    expect(report.invitation).toMatch(/export/i);
  });

  // TRUST RULE: the scan never fires on another rep's data.
  it('never leaks findings across tenants', async () => {
    const a = 'user-a';
    const b = 'user-b';
    const ca = await clients.create(a, 'A-Client');
    await facts.saveExtraction(a, {
      noteId: 'na',
      clientId: ca.id,
      promises: [{ text: 'A secret promise', owner: 'rep', due_date: '2026-08-01', due_raw: null, confidence: 'high' }],
    });
    const report = await scan.scan(b, Date.parse('2026-07-15T00:00:00Z'));
    expect(report.items).toEqual([]);
  });
});
