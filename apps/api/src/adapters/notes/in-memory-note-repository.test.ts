import { describe, it, expect } from 'vitest';
import { InMemoryNoteRepository } from './in-memory-note-repository.js';

describe('InMemoryNoteRepository', () => {
  const voice = { clientId: 'c1', source: 'voice' as const, rawText: null, audioKey: 'k1', status: 'pending_transcription' };

  it('creates a note under a client and lists it for that client', async () => {
    const repo = new InMemoryNoteRepository();
    const note = await repo.create('user-A', voice);
    expect(note.source).toBe('voice');
    expect(note.status).toBe('pending_transcription');
    expect((await repo.listByClient('user-A', 'c1')).map((n) => n.id)).toContain(note.id);
  });

  it('isolates notes by user (no cross-tenant read)', async () => {
    const repo = new InMemoryNoteRepository();
    const note = await repo.create('user-A', voice);
    expect(await repo.listByClient('user-B', 'c1')).toEqual([]);
    expect(await repo.findByIdForUser('user-B', note.id)).toBeNull();
  });

  // [FLOWS-5] the resume path: pending notes across ALL the rep's clients, so a
  // voice note stuck at pending_transcription can be advanced on app load.
  it('lists pending notes across clients for the user, tenant-scoped', async () => {
    const repo = new InMemoryNoteRepository();
    await repo.create('user-A', { clientId: 'c1', source: 'voice', rawText: null, audioKey: 'k', status: 'pending_transcription' });
    await repo.create('user-A', { clientId: 'c2', source: 'paste', rawText: 'x', audioKey: null, status: 'pending_extraction' });
    await repo.create('user-A', { clientId: 'c1', source: 'paste', rawText: 'y', audioKey: null, status: 'extracted' }); // not pending
    await repo.create('user-B', { clientId: 'c9', source: 'voice', rawText: null, audioKey: 'k', status: 'pending_transcription' }); // other tenant
    const pending = await repo.listPendingByUser('user-A');
    expect(pending.map((n) => n.status).sort()).toEqual(['pending_extraction', 'pending_transcription']);
    expect(pending.every((n) => n.userId === 'user-A')).toBe(true);
  });

  it('updates a note transcript and status', async () => {
    const repo = new InMemoryNoteRepository();
    const note = await repo.create('user-A', voice);
    await repo.update('user-A', note.id, { rawText: 'transcribed text', status: 'transcribed' });
    const got = await repo.findByIdForUser('user-A', note.id);
    expect(got?.rawText).toBe('transcribed text');
    expect(got?.status).toBe('transcribed');
  });
});
