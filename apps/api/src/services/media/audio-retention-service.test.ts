import { describe, it, expect } from 'vitest';
import { AudioRetentionService, AUDIO_RETENTION_DAYS } from './audio-retention-service.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryStorage } from '../../adapters/storage/in-memory.js';
import { TRANSCRIPTION_FAILED_STATUS } from '../transcription/transcription-service.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 1); // fixed clock

/** Seed a voice note with an audio object, at a given transcription age (days ago). */
async function seedVoice(
  notes: InMemoryNoteRepository,
  storage: InMemoryStorage,
  opts: { userId: string; key: string; transcribedDaysAgo: number | null; status?: string; createdDaysAgo?: number },
) {
  await storage.put(opts.key, new Uint8Array([1, 2, 3]));
  const note = await notes.create(opts.userId, {
    clientId: 'c1',
    source: 'voice',
    rawText: 'revised quote by Friday',
    audioKey: opts.key,
    status: opts.status ?? 'extracted',
  });
  await notes.update(opts.userId, note.id, {
    ...(opts.transcribedDaysAgo !== null ? { transcribedAt: NOW - opts.transcribedDaysAgo * DAY } : {}),
  });
  return note;
}

function makeSvc(notes: InMemoryNoteRepository, storage: InMemoryStorage, userIds: string[]) {
  return new AudioRetentionService(
    { allUserIds: async () => userIds, notes, storage },
    () => NOW,
  );
}

describe('[AUDIO-RETENTION] delete audio AUDIO_RETENTION_DAYS after transcription succeeds', () => {
  it('deletes the recording once past the window, and marks the note audio-expired (transcript kept)', async () => {
    const notes = new InMemoryNoteRepository();
    const storage = new InMemoryStorage();
    const note = await seedVoice(notes, storage, { userId: 'u', key: 'audio/u/k1.webm', transcribedDaysAgo: AUDIO_RETENTION_DAYS + 1 });

    const deleted = await makeSvc(notes, storage, ['u']).sweep();

    expect(deleted).toBe(1);
    expect(await storage.exists('audio/u/k1.webm')).toBe(false); // object gone
    const after = await notes.findByIdForUser('u', note.id);
    expect(after?.audioKey).toBeNull(); // row no longer points at it
    expect(after?.audioExpiredAt).toBe(NOW); // marked, so playback can say "no longer kept"
    expect(after?.rawText).toBe('revised quote by Friday'); // transcript remains
  });

  // NEGATIVE: inside the window → the recording is untouched.
  it('keeps a recording still inside the window', async () => {
    const notes = new InMemoryNoteRepository();
    const storage = new InMemoryStorage();
    const note = await seedVoice(notes, storage, { userId: 'u', key: 'audio/u/k2.webm', transcribedDaysAgo: AUDIO_RETENTION_DAYS - 1 });

    const deleted = await makeSvc(notes, storage, ['u']).sweep();

    expect(deleted).toBe(0);
    expect(await storage.exists('audio/u/k2.webm')).toBe(true);
    expect((await notes.findByIdForUser('u', note.id))?.audioKey).toBe('audio/u/k2.webm');
  });

  // NEGATIVE: the clock starts on TRANSCRIPTION, never on upload. A note uploaded long ago but never
  // transcribed (still pending) is never swept — the recording is the only copy of the capture.
  it('never sweeps a note that was never transcribed, however old the upload', async () => {
    const notes = new InMemoryNoteRepository();
    const storage = new InMemoryStorage();
    const note = await seedVoice(notes, storage, { userId: 'u', key: 'audio/u/k3.webm', transcribedDaysAgo: null, status: 'pending_transcription' });

    const deleted = await makeSvc(notes, storage, ['u']).sweep();

    expect(deleted).toBe(0);
    expect(await storage.exists('audio/u/k3.webm')).toBe(true);
    expect((await notes.findByIdForUser('u', note.id))?.audioKey).toBe('audio/u/k3.webm');
  });

  // NEGATIVE (the product's trust rule): a note in transcription_failed keeps its audio INDEFINITELY,
  // even if (pathologically) a transcribed_at is set and the window has long passed. Deleting it would
  // destroy the only recording of a note we could not transcribe.
  it('never sweeps a transcription_failed note, even past the window', async () => {
    const notes = new InMemoryNoteRepository();
    const storage = new InMemoryStorage();
    await seedVoice(notes, storage, {
      userId: 'u', key: 'audio/u/k4.webm', transcribedDaysAgo: AUDIO_RETENTION_DAYS + 100, status: TRANSCRIPTION_FAILED_STATUS,
    });

    const deleted = await makeSvc(notes, storage, ['u']).sweep();

    expect(deleted).toBe(0);
    expect(await storage.exists('audio/u/k4.webm')).toBe(true);
  });

  it('is idempotent — a second sweep deletes nothing', async () => {
    const notes = new InMemoryNoteRepository();
    const storage = new InMemoryStorage();
    await seedVoice(notes, storage, { userId: 'u', key: 'audio/u/k5.webm', transcribedDaysAgo: AUDIO_RETENTION_DAYS + 1 });
    const svc = makeSvc(notes, storage, ['u']);

    expect(await svc.sweep()).toBe(1);
    expect(await svc.sweep()).toBe(0);
  });

  it('sweeps across every rep (tenant-scoped per user)', async () => {
    const notes = new InMemoryNoteRepository();
    const storage = new InMemoryStorage();
    await seedVoice(notes, storage, { userId: 'a', key: 'audio/a/k.webm', transcribedDaysAgo: AUDIO_RETENTION_DAYS + 1 });
    await seedVoice(notes, storage, { userId: 'b', key: 'audio/b/k.webm', transcribedDaysAgo: AUDIO_RETENTION_DAYS + 1 });

    expect(await makeSvc(notes, storage, ['a', 'b']).sweep()).toBe(2);
    expect(await storage.exists('audio/a/k.webm')).toBe(false);
    expect(await storage.exists('audio/b/k.webm')).toBe(false);
  });

  // NEGATIVE: a storage delete failure must NOT clear the row — the object would be orphaned. The row
  // keeps its key and the next sweep retries (delete is idempotent).
  it('does not clear the note if the object delete fails (no orphaned object)', async () => {
    const notes = new InMemoryNoteRepository();
    const storage = new InMemoryStorage();
    const note = await seedVoice(notes, storage, { userId: 'u', key: 'audio/u/k6.webm', transcribedDaysAgo: AUDIO_RETENTION_DAYS + 1 });
    const failing = {
      delete: async () => { throw new Error('s3 down'); },
    };
    const svc = new AudioRetentionService({ allUserIds: async () => ['u'], notes, storage: failing }, () => NOW);

    await expect(svc.sweep()).rejects.toThrow();
    const after = await notes.findByIdForUser('u', note.id);
    expect(after?.audioKey).toBe('audio/u/k6.webm'); // still points at the (undeleted) object
    expect(after?.audioExpiredAt == null).toBe(true); // not marked expired
  });
});
