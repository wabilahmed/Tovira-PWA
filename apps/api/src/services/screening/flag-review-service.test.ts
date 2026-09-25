import { describe, it, expect, vi } from 'vitest';
import { FlagReviewService } from './flag-review-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { renderThread } from '../import/dedup.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

const M = (over: Partial<ImportedMessage> & { body: string }): ImportedMessage => ({ sentAt: 't', sender: 'Client', media: false, role: 'client', ...over });

async function seed() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const c = await clients.create('u', 'Marina');
  const messages = [
    M({ body: 'the party is on Friday', excluded: true, sensitive: [{ category: 'political_opinion', span: 'party', index: 4 }] }),
    M({ body: 'he is in hospital', excluded: true, sensitive: [{ category: 'health', span: 'hospital', index: 9 }] }),
    M({ body: 'send the floor plan' }),
  ];
  const note = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted', rawText: renderThread(messages), messages });
  return { notes, note };
}

describe('[SCREEN-REVIEW] FlagReviewService', () => {
  it('review() returns the held flags grouped category → span', async () => {
    const { notes, note } = await seed();
    const r = await new FlagReviewService(notes).review('u', note.id);
    expect(r!.held).toBe(2);
    expect(r!.groups.map((g) => g.category).sort()).toEqual(['health', 'political_opinion']);
  });

  it('restore() un-holds the matched messages, re-queues extraction, and emits the signal', async () => {
    const { notes, note } = await seed();
    const sink = { record: vi.fn(async () => {}) };
    const svc = new FlagReviewService(notes, sink);
    const out = await svc.restore('u', note.id, { category: 'political_opinion', span: 'party' });
    expect(out).toEqual({ restored: 1, status: 'pending_extraction' });
    const stored = await notes.findByIdForUser('u', note.id);
    expect(stored!.status).toBe('pending_extraction'); // RE-QUEUED for the sweep to re-extract
    expect(stored!.messages![0]!.excluded).toBe(false); // the party message is restored
    expect(stored!.messages![1]!.excluded).toBe(true); // the hospital message stays held (fail-closed)
    expect(sink.record).toHaveBeenCalledWith('political_opinion', 'party'); // signal emitted
    expect(sink.record).toHaveBeenCalledTimes(1);
  });

  it('restore() with nothing matched does NOT re-queue and emits no signal', async () => {
    const { notes, note } = await seed();
    const sink = { record: vi.fn(async () => {}) };
    const out = await new FlagReviewService(notes, sink).restore('u', note.id, { category: 'ethnicity' });
    expect(out!.restored).toBe(0);
    expect((await notes.findByIdForUser('u', note.id))!.status).toBe('extracted'); // unchanged, not re-queued
    expect(sink.record).not.toHaveBeenCalled();
  });

  it('review() and restore() on a missing note return null', async () => {
    const { notes } = await seed();
    expect(await new FlagReviewService(notes).review('u', 'nope')).toBeNull();
    expect(await new FlagReviewService(notes).restore('u', 'nope', { index: 0 })).toBeNull();
  });
});
