import { describe, it, expect } from 'vitest';
import { ExtractionService } from './extraction-service.js';
import { EXTRACTION_SYSTEM_PROMPT } from './prompt.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import { AiGateRefused } from '../spend/ai-gate.js';
import type { ModelClient, ModelCompletionRequest } from '../../ports/model.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/** [P23-B4] Windowed extraction inside the shipped ExtractionService (EXTRACT_WINDOWED). */
const U = 'u-win';
const WIN = { enabled: true, threshold: 150, size: 120, overlap: 20 };

/** A chat of n messages; message 5 is a rep promise, message 250 delivers it, message 260 restates the budget. */
function chat(n: number): ImportedMessage[] {
  const out: ImportedMessage[] = [];
  for (let i = 0; i < n; i++) {
    const day = String(1 + Math.floor(i / 10)).padStart(2, '0');
    const sentAt = `2026-03-${day}T${String(8 + (i % 10)).padStart(2, '0')}:00`;
    let body = `general chat ${i}`;
    let rep = i % 2 === 0;
    if (i === 4) { body = "I'll send you three villa options by Thursday"; rep = true; }
    if (i === 10) { body = 'Our budget is around 2.5M'; rep = false; }
    if (n > 250 && i === 250) { body = 'Here are the three villa options I promised'; rep = true; }
    if (n > 260 && i === 260) { body = 'Final budget is 3.1M'; rep = false; }
    out.push({ sender: rep ? 'Wabil' : 'Khalid', sentAt, body, media: false, role: rep ? 'rep' : 'client' });
  }
  return out;
}

/** A model that extracts exactly what its window contains (by the planted bodies). */
function windowAwareModel(seen: ModelCompletionRequest[], refuseOnCall?: number): ModelClient {
  return {
    complete: async (req) => {
      seen.push(req);
      if (refuseOnCall !== undefined && seen.length === refuseOnCall) throw new AiGateRefused('account_limit');
      const text = req.messages[0]!.content;
      const at = (body: string) => /\[([^\]]+)\] [^:]+: (.*)$/m.exec(text.split('\n').find((l) => l.includes(body)) ?? '')?.[1] ?? null;
      const promises = text.includes("I'll send you three villa options") ? [{ text: 'Send three villa options', owner: 'rep', due_date: null, due_raw: 'by Thursday', confidence: 'high', source_span: "I'll send you three villa options by Thursday", source_message_at: at("I'll send you three villa options") }] : [];
      const requirements = [
        ...(text.includes('Our budget is around 2.5M') ? [{ text: 'Budget around AED 2.5M', requirement_raw: 'Our budget is around 2.5M', stated_on: '2026-03-02', confidence: 'high' }] : []),
        ...(text.includes('Final budget is 3.1M') ? [{ text: 'Budget around AED 3.1M', requirement_raw: 'Final budget is 3.1M', stated_on: '2026-03-27', confidence: 'high' }] : []),
      ];
      return { text: JSON.stringify({ summary: `window with ${text.split('\n').filter((l) => l.startsWith('[')).length} messages`, promises, people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements, meeting: null }), usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
}

async function setup(n: number, windowing: typeof WIN | undefined, refuseOnCall?: number) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const seen: ModelCompletionRequest[] = [];
  const svc = new ExtractionService(windowAwareModel(seen, refuseOnCall), clients, notes, facts, new StubEmbedder(8), new InMemoryExtractionLogRepository(), 'stub',
    undefined, undefined, undefined, '1h', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, windowing);
  const client = await clients.create(U, 'Khalid');
  const messages = chat(n);
  const note = await notes.create(U, { clientId: client.id, source: 'whatsapp_export', rawText: messages.map((m) => m.body).join('\n'), audioKey: null, status: 'pending_extraction', messages });
  return { svc, notes, facts, seen, note, client };
}

describe('[P23-B4] the switch', () => {
  it('OFF: a 302-message chat is one call, exactly as today', async () => {
    const h = await setup(302, undefined);
    await h.svc.extractNote(U, h.note.id, '2026-04-01');
    expect(h.seen).toHaveLength(1);
  });
  it('ON, at or below N: byte-identical request and an identical stored extraction to switch-off', async () => {
    const off = await setup(150, undefined);
    const on = await setup(150, WIN);
    await off.svc.extractNote(U, off.note.id, '2026-04-01');
    await on.svc.extractNote(U, on.note.id, '2026-04-01');
    expect(on.seen).toHaveLength(1);
    expect(JSON.stringify(on.seen[0])).toBe(JSON.stringify(off.seen[0]));
    expect(JSON.stringify((await on.notes.findByIdForUser(U, on.note.id))!.extracted)).toBe(JSON.stringify((await off.notes.findByIdForUser(U, off.note.id))!.extracted));
  });
});

describe('[P23-B4] windowed (switch ON, chat over N)', () => {
  it('one call per window through the same certified prompt + metadata; each window is a slice of the thread', async () => {
    const h = await setup(302, WIN);
    await h.svc.extractNote(U, h.note.id, '2026-04-01');
    expect(h.seen).toHaveLength(3); // [0,120) [100,220) [200,302)
    for (const r of h.seen) {
      expect(r.system).toBe(EXTRACTION_SYSTEM_PROMPT);
      expect(r.cacheSystemPrompt).toBe(true);
      expect(r.messages[0]!.content).toContain('Khalid'); // same client metadata in every window
    }
    const counts = h.seen.map((r) => r.messages[0]!.content.split('\n').filter((l) => /^\[\d{4}-/.test(l)).length);
    expect(counts).toEqual([120, 120, 102]);
  });

  it('merges: the promise once and the later budget current — and a delivered promise STAYS OPEN (never auto-completed)', async () => {
    const h = await setup(302, WIN);
    await h.svc.extractNote(U, h.note.id, '2026-04-01');
    const stored = (await h.notes.findByIdForUser(U, h.note.id))!;
    const ex = stored.extracted as { promises: Array<{ text: string; kept_at?: string | null }>; requirements: Array<{ requirement_raw: string }> };
    expect(stored.status).toBe('extracted');
    expect(ex.promises).toHaveLength(1);
    expect(ex.promises[0]!.kept_at).toBeUndefined();
    expect(ex.requirements.map((r) => r.requirement_raw)).toEqual(['Final budget is 3.1M']);
    const [p] = await h.facts.listPromisesByUser(U);
    expect(p!.done).toBe(false); // [P24-2] only the rep closes a promise
  });

  it('allowance runs out mid-chat: stops cleanly — note re-queued, nothing saved, nothing half-merged', async () => {
    const h = await setup(302, WIN, 2); // the 2nd window is refused
    const out = await h.svc.extractNote(U, h.note.id, '2026-04-01');
    expect(out.status).toBe('spend_capped');
    const stored = (await h.notes.findByIdForUser(U, h.note.id))!;
    expect(stored.status).toBe('pending_extraction');
    expect(stored.extracted ?? null).toBeNull();
    expect(await h.facts.listPromisesByUser(U)).toHaveLength(0);
    expect(h.seen).toHaveLength(2); // stopped at the refusal — the 3rd window was never sent
  });

  it('a re-import of the same chat creates no duplicates', async () => {
    const h = await setup(302, WIN);
    await h.svc.extractNote(U, h.note.id, '2026-04-01');
    await h.notes.update(U, h.note.id, { status: 'pending_extraction' });
    await h.svc.extractNote(U, h.note.id, '2026-04-01');
    expect(await h.facts.listPromisesByUser(U, { includeDeleted: true })).toHaveLength(1);
    const ex = (await h.notes.findByIdForUser(U, h.note.id))!.extracted as { promises: unknown[]; requirements: unknown[] };
    expect(ex.promises).toHaveLength(1);
    expect(ex.requirements).toHaveLength(1);
  });

  it('NEGATIVE: a voice/paste note is never windowed, however long', async () => {
    const h = await setup(10, WIN);
    const long = await h.notes.create(U, { clientId: h.client.id, source: 'paste', rawText: 'x '.repeat(50_000), audioKey: null, status: 'pending_extraction' });
    h.seen.length = 0;
    await h.svc.extractNote(U, long.id, '2026-04-01');
    expect(h.seen).toHaveLength(1);
  });
});

describe('[P24-2] the facts store never closes a promise on its own', () => {
  it('a promise carrying a stray kept_at is still saved OPEN', async () => {
    const facts = new InMemoryFactsRepository();
    await facts.saveExtraction(U, { noteId: 'n1', clientId: 'c1', promises: [{ text: 'Send the options', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', kept_at: '2026-02-05T16:40' } as never] });
    const [p] = await facts.listPromisesByUser(U);
    expect(p!.done).toBe(false);
    expect(p!.doneAt).toBeNull();
  });
});
