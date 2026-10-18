import { describe, it, expect } from 'vitest';
import { ExtractionService } from '../extraction/extraction-service.js';
import { KeptSuggestionService, keptSuggestionCopy } from './kept-suggestion-service.js';
import { InMemoryKeptSuggestionRepository } from '../../adapters/promises/in-memory-kept-suggestion-repository.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import { BookScanService } from '../book-scan/book-scan-service.js';
import type { ModelClient } from '../../ports/model.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [P24-2] Kept promises are a SUGGESTION, never an automatic completion. A delivery the owner states later
 * in the chat ("Here are the options") creates a To Confirm suggestion linked to the promise, showing BOTH
 * receipts; the promise stays open everywhere until the rep taps Mark done (with Undo). "Not yet" dismisses
 * it — the same delivery message never suggests again, a NEW one can. Same in windowed and single-pass.
 */
const U = 'u-kept';
const m = (who: 'rep' | 'client', sentAt: string, body: string): ImportedMessage => ({ sender: who === 'rep' ? 'Wabil' : 'QA P14 Gate Client', sentAt, body, media: false, role: who });

/** A model that returns one rep promise when its window contains the promise message. */
function model(promiseText = 'Send the options', owner: 'rep' | 'client' = 'rep', promiseBody = "I'll send you three options by Thursday"): ModelClient {
  return {
    complete: async (req) => {
      const text = req.messages[0]!.content;
      const line = text.split('\n').find((l) => l.includes(promiseBody));
      const at = line ? /\[([^\]]+)\]/.exec(line)?.[1] ?? null : null;
      const promises = line ? [{ text: promiseText, owner, due_date: null, due_raw: 'by Thursday', confidence: 'high', source_span: promiseBody, source_message_at: at }] : [];
      return { text: JSON.stringify({ summary: 's', promises, people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null }), usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

function filler(n: number, startDay = 10): ImportedMessage[] {
  return Array.from({ length: n }, (_, i) => m(i % 2 ? 'client' : 'rep', `2026-03-${String(startDay + Math.floor(i / 20)).padStart(2, '0')}T${String(8 + (i % 10)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, `general chat ${i}`));
}

async function setup(messages: ImportedMessage[], opts: { windowed?: boolean; model?: ModelClient } = {}) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const repo = new InMemoryKeptSuggestionRepository();
  const kept = new KeptSuggestionService({ suggestions: repo, facts, clients });
  const svc = new ExtractionService(opts.model ?? model(), clients, notes, facts, new StubEmbedder(8), new InMemoryExtractionLogRepository(), 'stub',
    undefined, undefined, undefined, '1h', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    opts.windowed ? { enabled: true, threshold: 150, size: 120, overlap: 20 } : undefined, kept);
  const client = await clients.create(U, 'QA P14 Gate Client');
  const note = await notes.create(U, { clientId: client.id, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'pending_extraction', messages });
  return { svc, notes, facts, repo, kept, client, note, clients };
}

const PROMISE = m('rep', '2026-03-02T10:20', "I'll send you three options by Thursday");
const DELIVERY = m('rep', '2026-03-05T16:40', 'Here are the options');

describe('[P24-2] delivery → suggestion, promise stays open', () => {
  it('a detected delivery creates a To Confirm suggestion linked to the promise, with BOTH receipts; the promise stays open', async () => {
    const h = await setup([PROMISE, m('client', '2026-03-03T09:00', 'Thanks'), DELIVERY]);
    await h.svc.extractNote(U, h.note.id, '2026-03-06');
    const [p] = await h.facts.listPromisesByUser(U);
    expect(p!.done).toBe(false);
    const list = await h.kept.listOpen(U);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      promiseId: p!.id,
      clientId: h.client.id,
      message: 'Looks like you sent the options to QA P14 Gate Client. Mark done?',
      promise: { quote: "I'll send you three options by Thursday", date: '2026-03-02' },
      delivery: { quote: 'Here are the options', date: '2026-03-05' },
    });
  });

  it('Mark done → the promise is done; Undo restores it (open, and the suggestion is back)', async () => {
    const h = await setup([PROMISE, DELIVERY]);
    await h.svc.extractNote(U, h.note.id, '2026-03-06');
    const [s] = await h.kept.listOpen(U);
    expect(await h.kept.markDone(U, s!.id)).toBe(true);
    expect((await h.facts.listPromisesByUser(U))[0]!.done).toBe(true);
    expect(await h.kept.listOpen(U)).toHaveLength(0);
    expect(await h.kept.undo(U, s!.id)).toBe(true);
    expect((await h.facts.listPromisesByUser(U))[0]!.done).toBe(false);
    expect(await h.kept.listOpen(U)).toHaveLength(1);
  });

  it('Not yet → dismissed; the SAME delivery message never suggests again (even on re-import), a LATER one does', async () => {
    const h = await setup([PROMISE, DELIVERY]);
    await h.svc.extractNote(U, h.note.id, '2026-03-06');
    const [s] = await h.kept.listOpen(U);
    expect(await h.kept.notYet(U, s!.id)).toBe(true);
    expect(await h.kept.listOpen(U)).toHaveLength(0);
    // Re-extract the same chat: no repeat from the same message.
    await h.notes.update(U, h.note.id, { status: 'pending_extraction' });
    await h.svc.extractNote(U, h.note.id, '2026-03-06');
    expect(await h.kept.listOpen(U)).toHaveLength(0);
    // A new delivery message arrives in the chat → it suggests again.
    await h.notes.update(U, h.note.id, { status: 'pending_extraction', messages: [PROMISE, DELIVERY, m('rep', '2026-03-09T11:00', 'Sent you the options again, attached')] });
    await h.svc.extractNote(U, h.note.id, '2026-03-10');
    const again = await h.kept.listOpen(U);
    expect(again).toHaveLength(1);
    expect(again[0]!.delivery).toEqual({ quote: 'Sent you the options again, attached', date: '2026-03-09' });
    expect((await h.facts.listPromisesByUser(U))[0]!.done).toBe(false);
  });

  it('NEGATIVE: "still not fixed" never suggests', async () => {
    const h = await setup([m('rep', '2026-06-15T09:40', "I'll get the landlord to fix the AC"), m('rep', '2026-07-02T20:00', 'Here is the update: the AC is still not fixed')],
      { model: model('Get the landlord to fix the AC', 'rep', "I'll get the landlord to fix the AC") });
    await h.svc.extractNote(U, h.note.id, '2026-07-03');
    expect(await h.kept.listOpen(U)).toHaveLength(0);
  });

  it('NEGATIVE: a delivery from the wrong owner does not suggest', async () => {
    const h = await setup([PROMISE, m('client', '2026-03-05T16:40', 'Here are the options you wanted, attached')]);
    await h.svc.extractNote(U, h.note.id, '2026-03-06');
    expect(await h.kept.listOpen(U)).toHaveLength(0);
  });

  it('windowed and single-pass give the same suggestion for the same chat', async () => {
    const chat = [PROMISE, ...filler(260), m('rep', '2026-03-30T16:40', 'Here are the options')];
    const single = await setup(chat);
    const windowed = await setup(chat, { windowed: true });
    await single.svc.extractNote(U, single.note.id, '2026-03-31');
    await windowed.svc.extractNote(U, windowed.note.id, '2026-03-31');
    const strip = (xs: Awaited<ReturnType<KeptSuggestionService['listOpen']>>) => xs.map(({ message, promise, delivery }) => ({ message, promise, delivery }));
    const a = strip(await single.kept.listOpen(U));
    expect(a).toHaveLength(1);
    expect(strip(await windowed.kept.listOpen(U))).toEqual(a);
    expect((await windowed.facts.listPromisesByUser(U))[0]!.done).toBe(false);
  });

  it('while unanswered the promise stays open in Book Scan, with "(looks sent — confirm)"', async () => {
    const h = await setup([PROMISE, DELIVERY]);
    await h.svc.extractNote(U, h.note.id, '2026-03-06');
    const scan = new BookScanService({ clients: h.clients, notes: h.notes, facts: h.facts }, { coldThresholdDays: 30, upcomingWindowDays: 30, promiseStaleThresholdDays: 400 }, h.kept);
    const item = (await scan.scan(U, Date.parse('2026-03-06T00:00:00Z'))).items.find((i) => i.kind === 'open_promise')!;
    expect(item.headline).toBe('Worth checking: did you send the options? (looks sent — confirm)');
  });
});

describe('[P24-2] copy', () => {
  it('rep and client promises', () => {
    expect(keptSuggestionCopy('rep', 'Send the options', 'QA P14 Gate Client')).toBe('Looks like you sent the options to QA P14 Gate Client. Mark done?');
    expect(keptSuggestionCopy('client', 'Send the mortgage pre-approval letter', 'Khalid')).toBe('Looks like Khalid sent the mortgage pre-approval letter. Mark done?');
    expect(keptSuggestionCopy('rep', 'Share the floor plans', 'Sara')).toBe('Looks like you shared the floor plans with Sara. Mark done?');
    expect(keptSuggestionCopy('rep', 'Arrange the viewing', 'Sara')).toBe('Looks like you did this for Sara: "Arrange the viewing". Mark done?');
  });
});
