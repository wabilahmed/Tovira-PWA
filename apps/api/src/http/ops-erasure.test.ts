import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleOpsRoute, type OpsRouteDeps } from './ops-routes.js';
import { ErasureService } from '../services/erasure/erasure-service.js';
import { ErasureRequestService } from '../services/erasure/erasure-request-service.js';
import { InMemoryClientRepository } from '../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../adapters/notes/in-memory-note-repository.js';
import { InMemoryExtractionLogRepository } from '../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryErasureAuditRepository } from '../adapters/erasure/in-memory-erasure-audit-repository.js';
import { InMemoryErasureRequestRepository } from '../adapters/erasure/in-memory-erasure-request-repository.js';
import { InMemoryNotificationRepository } from '../adapters/notifications/in-memory-notification-repository.js';

const TOKEN = 'ops-sekret';

function req(method: string, url: string, headers: Record<string, string> = {}, body?: unknown): IncomingMessage {
  const r = Readable.from([Buffer.from(body === undefined ? '' : JSON.stringify(body))]) as unknown as IncomingMessage;
  r.method = method; r.url = url; r.headers = headers;
  return r;
}
function res(): { res: ServerResponse; status: () => number; raw: () => string } {
  let statusCode = 0; let payload = '';
  const r = { setHeader() {}, writeHead(code: number) { statusCode = code; return this; }, end(chunk?: string) { if (chunk) payload = chunk; } } as unknown as ServerResponse;
  return { res: r, status: () => statusCode, raw: () => payload };
}

async function setup() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const requests = new InMemoryErasureRequestRepository();
  const notifications = new InMemoryNotificationRepository();
  const erasure = new ErasureService({ clients, notes, extractionLog: new InMemoryExtractionLogRepository(), audit: new InMemoryErasureAuditRepository() });
  const erasureRequests = new ErasureRequestService({ erasure, requests, notifications, dispatch: vi.fn(async () => {}) });
  // A note with data about Khalid, so a valid-token preview is non-empty.
  const c = await clients.create('u', 'Marina Estates');
  const n = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted', rawText: 'x', messages: [] });
  await notes.update('u', n.id, { extracted: { people: [{ name: 'Khalid', role: null, reports_to: null, decision_role: 'unknown', notes: null }], personal_facts: [], promises: [], key_dates: [], concerns: [], next_steps: [], meeting: null, unanswered_questions: [] } });
  const deps: OpsRouteDeps = {
    opsToken: TOKEN,
    overrides: {} as never, spend: {} as never, allUserIds: async () => ['u'],
    erasure, erasureRequests,
  };
  return { deps, requests };
}

describe('[ERASURE Task 5] operator intake', () => {
  it('the operator path requires the ops token: only a valid token opens a request', async () => {
    const { deps, requests } = await setup();
    // No token → no request created.
    const r1 = res();
    await handleOpsRoute(req('POST', '/ops/erasure/open', {}, { userId: 'u', requesterNames: ['Khalid'] }), r1.res, deps);
    expect(await requests.listByUser('u')).toHaveLength(0);
    // Valid token → the request is opened.
    const r2 = res();
    await handleOpsRoute(req('POST', '/ops/erasure/open', { 'x-ops-token': TOKEN }, { userId: 'u', requesterNames: ['Khalid'] }), r2.res, deps);
    expect(await requests.listByUser('u')).toHaveLength(1);
  });

  it('an unauthenticated caller gets a BYTE-IDENTICAL response to an unknown-counterparty request', async () => {
    const { deps } = await setup();
    // Authenticated preview for an UNKNOWN counterparty → empty plan.
    const authedUnknown = res();
    await handleOpsRoute(req('POST', '/ops/erasure/preview', { 'x-ops-token': TOKEN }, { userId: 'u', requesterNames: ['Ghost'] }), authedUnknown.res, deps);
    // Unauthenticated preview, same request → must be byte-identical.
    const unauth = res();
    await handleOpsRoute(req('POST', '/ops/erasure/preview', {}, { userId: 'u', requesterNames: ['Ghost'] }), unauth.res, deps);
    expect(unauth.raw()).toBe(authedUnknown.raw()); // byte-identical — auth-fail is indistinguishable from unknown
  });

  it('an unauthenticated probe for a REAL counterparty leaks nothing (looks like unknown)', async () => {
    const { deps } = await setup();
    // Authenticated operator preview for the real Khalid → sees the data.
    const authedKnown = res();
    await handleOpsRoute(req('POST', '/ops/erasure/preview', { 'x-ops-token': TOKEN }, { userId: 'u', requesterNames: ['Khalid'] }), authedKnown.res, deps);
    expect((JSON.parse(authedKnown.raw()) as { autoDelete: unknown[] }).autoDelete.length).toBeGreaterThan(0); // operator sees Khalid
    // Unauthenticated probe for the SAME real name → empty, exactly like an unknown counterparty.
    const unauth = res();
    await handleOpsRoute(req('POST', '/ops/erasure/preview', {}, { userId: 'u', requesterNames: ['Khalid'] }), unauth.res, deps);
    expect((JSON.parse(unauth.raw()) as { autoDelete: unknown[] }).autoDelete).toEqual([]); // no data leaked
  });
});
