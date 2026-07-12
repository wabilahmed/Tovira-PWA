import { describe, it, expect } from 'vitest';
import { InMemoryFactsRepository } from './in-memory-facts-repository.js';
import type { ExtractedPromise } from '../../services/extraction/types.js';

const promise = (text: string): ExtractedPromise => ({
  text,
  owner: 'rep',
  due_date: null,
  due_raw: 'Friday',
  confidence: 'high',
});

describe('InMemoryFactsRepository', () => {
  it('saves promises for a note and lists them by user', async () => {
    const repo = new InMemoryFactsRepository();
    await repo.saveExtraction('user-A', { noteId: 'n1', clientId: 'c1', promises: [promise('send quote')] });
    expect(await repo.listPromisesByUser('user-A')).toHaveLength(1);
  });

  it('is idempotent per note — re-saving replaces, not duplicates', async () => {
    const repo = new InMemoryFactsRepository();
    await repo.saveExtraction('user-A', { noteId: 'n1', clientId: 'c1', promises: [promise('a'), promise('b')] });
    await repo.saveExtraction('user-A', { noteId: 'n1', clientId: 'c1', promises: [promise('a')] });
    expect(await repo.listPromisesByNote('user-A', 'n1')).toHaveLength(1);
  });

  it('isolates spine rows by user', async () => {
    const repo = new InMemoryFactsRepository();
    await repo.saveExtraction('user-A', { noteId: 'n1', clientId: 'c1', promises: [promise('a')] });
    expect(await repo.listPromisesByUser('user-B')).toEqual([]);
  });

  it('confirms a promise (and rejects confirming another user\'s promise)', async () => {
    const repo = new InMemoryFactsRepository();
    await repo.saveExtraction('user-A', { noteId: 'n1', clientId: 'c1', promises: [promise('a')] });
    const [p] = await repo.listPromisesByUser('user-A');
    expect(p!.confirmed).toBe(false);
    expect(await repo.confirmPromise('user-B', p!.id)).toBe(false); // isolation
    expect(await repo.confirmPromise('user-A', p!.id)).toBe(true);
    expect((await repo.listPromisesByUser('user-A'))[0]!.confirmed).toBe(true);
  });
});
