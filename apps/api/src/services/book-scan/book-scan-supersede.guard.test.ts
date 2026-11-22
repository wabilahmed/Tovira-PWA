import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BookScanService } from './book-scan-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';

/**
 * [P85-1 · owner, 22 Nov] "A test that stops the Book Scan ever showing an outdated item in future." Book Scan lists
 * open promises, unanswered questions, quiet clients and upcoming dates, and no requirement today. This guard holds
 * that: (1) a client whose chat has a replaced count gets no Book Scan item quoting either need, and (2) if Book
 * Scan ever reads requirements, its source must read them through currentRequirements / currentAcrossClients
 * (the P84-7 supersede), so a replaced count can never appear as current.
 */
const SOURCE = readFileSync(fileURLToPath(new URL('./book-scan-service.ts', import.meta.url)), 'utf8');

describe('[P85-1] Book Scan never shows an outdated requirement', () => {
  it('a chat with a replaced count yields no item quoting a requirement', async () => {
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository(); const facts = new InMemoryFactsRepository();
    const c = await clients.create('u', 'Anjali Mehra');
    const n = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted' } as never);
    await notes.update('u', n.id, { extracted: { summary: 's', promises: [], key_dates: [], people: [], unanswered_questions: [], requirements: [
      { text: 'At least 3 bedrooms', requirement_raw: 'We need at least 3 bedrooms', stated_on: '2026-03-01', confidence: 'high' },
      { text: '4 bedrooms not 3', requirement_raw: 'so we need 4 bedrooms not 3', stated_on: '2026-09-01', confidence: 'high' },
    ] } as never });
    const report = await new BookScanService({ clients, notes, facts }, { coldThresholdDays: 30, upcomingWindowDays: 30 }).scan('u', Date.parse('2026-11-22T09:00:00Z'));
    const shown = report.items.map((i) => `${i.headline} ${i.receipt.quote}`).join('\n');
    expect(shown).not.toMatch(/3 bedrooms|4 bedrooms/i);
  });

  it('if Book Scan reads requirements, it reads only the current ones', () => {
    const reads = /requirements?\s*[.:]|listOpenByUser|RequirementRepository|requirementsBy|\.requirements\b/.test(SOURCE);
    if (reads) expect(SOURCE).toMatch(/currentRequirements|currentAcrossClients/);
    else expect(reads).toBe(false);
  });
});
