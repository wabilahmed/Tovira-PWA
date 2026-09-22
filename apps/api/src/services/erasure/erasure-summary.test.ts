import { describe, it, expect, vi, afterEach } from 'vitest';
import { ErasureService } from './erasure-service.js';
import { ErasureRequestService } from './erasure-request-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryErasureAuditRepository } from '../../adapters/erasure/in-memory-erasure-audit-repository.js';
import { InMemoryErasureRequestRepository } from '../../adapters/erasure/in-memory-erasure-request-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { MeteredModelClient, setSpendSink, type SpendSink } from '../../adapters/model/metered.js';
import { ModelMetricsRegistry } from '../metrics/model-metrics.js';
import type { ModelClient, ModelCompletionRequest } from '../../ports/model.js';

/**
 * [ERASURE-SUMMARY] After the requester's messages are removed, re-run the certified extractor and take
 * ONLY the new summary. If it still names her, surface it (never silently accept). The rewrite is
 * charged to NO account — erasure is Prospera's legal obligation, not the rep's usage.
 */
afterEach(() => setSpendSink(undefined));

// A stub certified extractor: returns a caller-chosen summary and empty everything-else (a real re-run
// output shape). `spy` captures the request so we can assert how it was charged.
function stubSummariser(summary: string, spy?: (req: ModelCompletionRequest) => void): ModelClient {
  return {
    complete: async (req) => {
      spy?.(req);
      return { text: JSON.stringify({ summary, people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], promises: [], requirements: [], meeting: null, unanswered_questions: [] }), usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

async function seed(clients: InMemoryClientRepository, notes: InMemoryNoteRepository, userId: string) {
  const c = await clients.create(userId, 'Marina Estates');
  const n = await notes.create(userId, {
    clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted',
    rawText: 'x',
    messages: [
      { sentAt: '2026-01-01T10:00:00', sender: 'Zelda Quorn', body: 'I hold 4m in escrow', media: false, role: 'unknown' },
      { sentAt: '2026-01-01T10:01:00', sender: 'Alex', body: 'noted, thanks', media: false, role: 'client' },
    ],
  });
  await notes.update(userId, n.id, {
    extracted: {
      summary: 'Zelda Quorn holds 4m in escrow; Alex acknowledged.',
      people: [{ name: 'Zelda Quorn', role: null, reports_to: null, decision_role: 'unknown', notes: null }, { name: 'Alex', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
      personal_facts: [],
      // Other fields that must NOT be touched by the rewrite:
      promises: [{ text: 'Send Alex the plan', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: 'send the plan', source_message_at: null }],
      key_dates: [{ description: 'Handover in March', date: null, date_raw: 'March', type: 'deadline', source_span: 'March', source_message_at: null }],
      concerns: [], next_steps: [], meeting: null, unanswered_questions: [],
    },
  });
  return n;
}

const exOf = async (notes: InMemoryNoteRepository, u: string, id: string) => (await notes.findByIdForUser(u, id))!.extracted as Record<string, unknown>;

describe('[ERASURE-SUMMARY] rewrite the summary after removing the requester', () => {
  it('a clean rewrite replaces ONLY the summary; every other field is unchanged', async () => {
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
    const n = await seed(clients, notes, 'u');
    const before = await exOf(notes, 'u', n.id);
    const svc = new ErasureService({ clients, notes, extractionLog: new InMemoryExtractionLogRepository(), audit: new InMemoryErasureAuditRepository(), summariser: stubSummariser('Alex acknowledged the update.') });
    const res = await svc.commit('u', ['Zelda Quorn']);
    const after = await exOf(notes, 'u', n.id);
    expect(after.summary).toBe('Alex acknowledged the update.'); // rewritten, no Zelda
    expect(res.needsReview).toEqual([]); // clean → nothing to review
    // EVERY other field byte-identical (model variance must never silently change a rep's other facts):
    expect(after.promises).toEqual(before.promises);
    expect(after.key_dates).toEqual(before.key_dates);
    // (people/messages did change — Zelda is deleted there — that's the structured erasure, not the rewrite.)
  });

  it('a rewrite that STILL names her is SURFACED as needsReview, not silently accepted', async () => {
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
    const n = await seed(clients, notes, 'u');
    const svc = new ErasureService({ clients, notes, extractionLog: new InMemoryExtractionLogRepository(), audit: new InMemoryErasureAuditRepository(), summariser: stubSummariser('Zelda Quorn is still keen; Alex noted.') });
    const res = await svc.commit('u', ['Zelda Quorn']);
    expect(res.needsReview).toHaveLength(1);
    expect(res.needsReview[0]!.id).toBe(`${n.id}:summary:0`);
    expect(res.needsReview[0]!.snippet).toMatch(/Zelda/);
  });

  it('flagging the surfaced summary deletes it WHOLE on the next commit', async () => {
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
    const n = await seed(clients, notes, 'u');
    const svc = new ErasureService({ clients, notes, extractionLog: new InMemoryExtractionLogRepository(), audit: new InMemoryErasureAuditRepository(), summariser: stubSummariser('Zelda Quorn is still keen.') });
    const res = await svc.commit('u', ['Zelda Quorn'], { flaggedMentionIds: [`${n.id}:summary:0`] });
    expect(res.needsReview).toEqual([]); // flagged → deleted whole, nothing left to review
    expect((await exOf(notes, 'u', n.id)).summary).toBeNull(); // whole deletion (never an edit)
  });

  it('the rewrite call is charged to NO account: spendClass "erasure", no userId, rep ledger untouched', async () => {
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
    await seed(clients, notes, 'u');
    const seen: ModelCompletionRequest[] = [];
    // A metered client with a spend sink: if the call carried the rep's userId, the ledger would record it.
    const spend = vi.fn(async () => {}) as unknown as SpendSink['record'];
    setSpendSink({ record: spend } as SpendSink);
    const metered = new MeteredModelClient(stubSummariser('Alex noted.', (r) => seen.push(r)), 'extraction', 'claude-sonnet-5', new ModelMetricsRegistry());
    const svc = new ErasureService({ clients, notes, extractionLog: new InMemoryExtractionLogRepository(), audit: new InMemoryErasureAuditRepository(), summariser: metered });
    await svc.commit('u', ['Zelda Quorn']);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.spendClass).toBe('erasure');
    expect(seen[0]!.userId).toBeUndefined(); // never the rep
    expect(spend).not.toHaveBeenCalled(); // no userId → the spend ledger (cap) is never touched
  });
});

describe('[ERASURE-SUMMARY] complete() refuses while a candidate is unreviewed', () => {
  it('refuses (summary_needs_review) while the rewritten summary still names her, then finalises once flagged', async () => {
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
    await seed(clients, notes, 'u');
    const now = { t: Date.parse('2026-09-20T09:00:00Z') };
    const erasure = new ErasureService({ clients, notes, extractionLog: new InMemoryExtractionLogRepository(), audit: new InMemoryErasureAuditRepository(), summariser: stubSummariser('Zelda Quorn is still keen.') });
    const svc = new ErasureRequestService({ erasure, requests: new InMemoryErasureRequestRepository(), notifications: new InMemoryNotificationRepository(), dispatch: async () => {}, now: () => now.t });
    const req = await svc.open('u', ['Zelda Quorn']);

    now.t = Date.parse('2026-10-10T00:00:00Z'); // window (14d) elapsed → eligible to complete
    const refused = await svc.complete('u', req.id);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('summary_needs_review'); // the rewrite still names her → not silently finalised
    expect(refused.candidates?.[0]?.id).toContain(':summary:0');

    // operator flags the surfaced summary → re-complete deletes it whole and finalises
    const done = await svc.complete('u', req.id, { flaggedMentionIds: [refused.candidates![0]!.id] });
    expect(done.ok).toBe(true);
  });
});
