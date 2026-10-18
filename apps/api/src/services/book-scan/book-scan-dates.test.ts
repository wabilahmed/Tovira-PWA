import { describe, it, expect, beforeEach } from 'vitest';
import { BookScanService } from './book-scan-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';

/**
 * [P21-B / ONB-02 / BOOK-01] Every Book Scan receipt is dated by its SOURCE MESSAGE. Retest: an imported
 * promise from a 2 Mar 2026 message showed "Send three villa options · 14 Oct 2026" (the import / due day).
 */
const USER = 'u-b';
const NOW = Date.parse('2026-10-18T09:00:00Z');
let clients: InMemoryClientRepository;
let notes: InMemoryNoteRepository;
let facts: InMemoryFactsRepository;
let scan: BookScanService;

beforeEach(() => {
  clients = new InMemoryClientRepository();
  notes = new InMemoryNoteRepository();
  facts = new InMemoryFactsRepository();
  scan = new BookScanService({ clients, notes, facts }, { coldThresholdDays: 30, upcomingWindowDays: 30, promiseStaleThresholdDays: 400 });
});

describe('[P21-B] Book Scan items are dated by their source message', () => {
  it('an imported March promise shows its March message date, not the due or import day', async () => {
    const c = await clients.create(USER, 'QA P14 Gate Client');
    await facts.saveExtraction(USER, {
      noteId: 'n1', clientId: c.id, captureAt: '2026-03-09',
      promises: [{ text: 'Send three villa options', owner: 'rep', due_date: '2026-10-14', due_raw: 'next week', confidence: 'high', source_span: 'I will send three villa options', source_message_at: '2026-03-02T11:40:00' }],
    });
    const item = (await scan.scan(USER, NOW)).items.find((i) => i.kind === 'open_promise')!;
    expect(item.receipt.quote).toBe('Send three villa options');
    expect(item.receipt.date).toBe('2026-03-02');
  });

  it('a promise with no per-message time (voice/paste) is dated by its conversation (capture) date', async () => {
    const c = await clients.create(USER, 'QA Sara Khan');
    await facts.saveExtraction(USER, {
      noteId: 'n2', clientId: c.id, captureAt: '2026-05-01',
      promises: [{ text: 'call back about the 2-bed', owner: 'rep', due_date: '2026-10-30', due_raw: null, confidence: 'high' }],
    });
    const item = (await scan.scan(USER, NOW)).items.find((i) => i.kind === 'open_promise')!;
    expect(item.receipt.date).toBe('2026-05-01');
  });
});
