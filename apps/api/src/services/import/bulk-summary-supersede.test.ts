import { describe, it, expect, vi } from 'vitest';
import { BulkImportService } from './bulk-import-service.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';
import type { ClientRecord, ClientRepository } from '../../ports/client-repository.js';
import type { NoteRecord, NoteRepository, NewNote } from '../../ports/note-repository.js';
import type { ExtractOutcome } from '../extraction/extraction-service.js';

/**
 * [P85-1 · owner, 22 Nov] "Imported N chats. Found X promises, Y requirements." counts only CURRENT requirements:
 * a need a later count replaced (P83-8) is not counted, whether the later count is in the same chat or in a note the
 * client already had. "Found 5 requirements" must never count one that has since been replaced.
 */
const clientRecord = (id: string, userId: string, name: string) => ({ id, userId, name, phone: null, createdAt: 0 } as unknown as ClientRecord);
function fakeClients(seed: ClientRecord[] = []): ClientRepository {
  const all = [...seed];
  return {
    listByUser: async (uid: string) => all.filter((c) => c.userId === uid),
    create: async (uid: string, name: string) => { const c = clientRecord(`c${all.length + 1}`, uid, name); all.push(c); return c; },
    touch: async () => {},
  } as unknown as ClientRepository;
}
function fakeNotes(): NoteRepository & { all: NoteRecord[] } {
  const all: NoteRecord[] = [];
  return {
    all,
    listByClient: async (uid: string, cid: string) => all.filter((n) => n.userId === uid && n.clientId === cid),
    findByIdForUser: async (uid: string, id: string) => all.find((n) => n.userId === uid && n.id === id) ?? null,
    create: async (uid: string, note: NewNote) => { const n = { id: `n${all.length + 1}`, userId: uid, createdAt: 0, ...note } as unknown as NoteRecord; all.push(n); return n; },
  } as unknown as NoteRepository & { all: NoteRecord[] };
}
const chat = ['13/07/2026, 1:00 am - Wabil: hi', '13/07/2026, 1:01 am - Layla: hello, about the villa'].join('\n');
const req = (text: string, stated_on: string) => ({ text, requirement_raw: text, stated_on, confidence: 'high' });

async function run(found: Array<ReturnType<typeof req>>, opts: { earlier?: Array<ReturnType<typeof req>>; repo?: boolean } = {}) {
  const notes = fakeNotes();
  const clients = fakeClients([clientRecord('c1', 'u', 'Layla')]);
  const requirements = new InMemoryRequirementRepository();
  if (opts.earlier) await requirements.saveForNote('u', 'old', 'c1', opts.earlier.map((r) => ({ text: r.text, requirementRaw: r.requirement_raw, statedOn: r.stated_on, confidence: 'high' as const, embedding: null })));
  const extract = vi.fn(async (_u: string, id: string): Promise<ExtractOutcome> => {
    const n = notes.all.find((x) => x.id === id)!;
    (n as { extracted?: unknown }).extracted = { promises: [{}], requirements: found };
    if (opts.repo !== false) await requirements.saveForNote('u', id, n.clientId, found.map((r) => ({ text: r.text, requirementRaw: r.requirement_raw, statedOn: r.stated_on, confidence: 'high' as const, embedding: null })));
    return { status: 'extracted' };
  });
  const svc = new BulkImportService({ clients, notes, extract, isExhausted: async () => false, concurrency: 1, allowanceAed: 45, modelId: 'claude-sonnet-5', ...(opts.repo === false ? {} : { requirements }) });
  const res = await svc.importConfirmed('u', [{ name: 'a.txt', content: chat }], [{ fileName: 'a.txt', action: 'merge', clientId: 'c1' } as never], '2026-10-04');
  return res.summary;
}

describe('[P85-1] the import summary counts only current requirements', () => {
  it('a count replaced later in the same chat is not counted', async () => {
    expect(await run([req('At least 3 bedrooms', '2026-03-01'), req('4 bedrooms not 3', '2026-06-01'), req('Budget AED 2M', '2026-07-01')])).toMatchObject({ requirements: 2 });
  });
  it('the same holds read from the chat alone (no requirement store wired)', async () => {
    expect(await run([req('At least 3 bedrooms', '2026-03-01'), req('4 bedrooms not 3', '2026-06-01')], { repo: false })).toMatchObject({ requirements: 1 });
  });
  it('NEGATIVE: the chat\'s own later count is counted when it replaces a need the client already had', async () => {
    expect(await run([req('4 bedrooms not 3', '2026-06-01')], { earlier: [req('At least 3 bedrooms', '2026-03-01')] })).toMatchObject({ requirements: 1 });
  });
  it('NEGATIVE: a need that says more than a count is still counted', async () => {
    expect(await run([req('3 bedroom villa in Mirdif', '2026-03-01'), req('4 bedrooms not 3', '2026-06-01')])).toMatchObject({ requirements: 2 });
  });
});
