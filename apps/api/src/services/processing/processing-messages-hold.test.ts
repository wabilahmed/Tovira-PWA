import { describe, it, expect } from 'vitest';
import { ProcessingStatusService, type HoldReason } from './processing-status.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [P84-9 · owner, 22 Nov] "The processing card shows 'Waiting for messages: add messages to read this chat' when a
 * chat is held." A queued chat whose messages to read are more than the rep has left is held for messages (hold
 * 'messages'), not shown as working. The billing holds (trial ended, payment) still win.
 */
const U = 'u';
const NOW = Date.parse('2026-11-10T09:00:00Z');
const msgs = (n: number): ImportedMessage[] =>
  Array.from({ length: n }, (_, i) => ({ sentAt: `2026-11-0${1 + (i % 9)}T10:00`, sender: i % 2 ? 'Me' : 'Anjali', body: `About the villa in Mirdif, option number ${i} with the garden and the pool`, media: false, role: i % 2 ? 'rep' : 'client' }) as ImportedMessage);

async function setup(opts: { left: number; charged?: boolean; billing?: HoldReason | null; source?: 'whatsapp_export' | 'paste'; count?: number }) {
  const notes = new InMemoryNoteRepository();
  const clients = new InMemoryClientRepository();
  const c = await clients.create(U, 'Anjali Mehra');
  await notes.create(U, { clientId: c.id, source: opts.source ?? 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'pending_extraction', messages: opts.source === 'paste' ? undefined : msgs(opts.count ?? 40) } as never);
  const svc = new ProcessingStatusService({
    notes, clients, facts: new InMemoryFactsRepository(), requirements: new InMemoryRequirementRepository(), meetings: new InMemoryMeetingRepository(),
    holdReason: async () => opts.billing ?? null,
    today: async () => '2026-11-10',
    messages: { left: async () => opts.left, isCharged: async () => opts.charged ?? false },
  });
  return { item: (await svc.status(U, NOW)).items[0]!, working: (await svc.status(U, NOW)).working };
}

describe('[P84-9] a chat waiting for messages', () => {
  it('more to read than is left: held for messages, not working', async () => {
    const { item, working } = await setup({ left: 10 });
    expect(item).toMatchObject({ kind: 'chat', state: 'held', hold: 'messages' });
    expect(working).toBe(0);
  });
  it('NEGATIVE: enough left: working as before', async () => {
    const { item } = await setup({ left: 10_000 });
    expect(item).toMatchObject({ state: 'working' });
  });
  it('NEGATIVE: already counted (it is being read): never held for messages', async () => {
    const { item } = await setup({ left: 0, charged: true });
    expect(item.state).toBe('working');
  });
  it('NEGATIVE: a typed note never waits for messages', async () => {
    const { item } = await setup({ left: 0, source: 'paste' });
    expect(item.state).toBe('working');
  });
  it('NEGATIVE: a billing hold still wins (the trial ended)', async () => {
    const { item } = await setup({ left: 0, billing: 'subscribe' });
    expect(item).toMatchObject({ state: 'held', hold: 'subscribe' });
  });
});
