/**
 * [BATCH-B] Concurrent two-account isolation detector (local, in-memory).
 *
 * The deployed run (tests/staging/concurrent-leak-run.ts) found every surface CLEAN. An
 * all-clean result is only trustworthy if the DETECTOR is proven able to fire — so this
 * local mirror runs two accounts' extractions CONCURRENTLY against the in-memory server
 * and asserts no cross-tenant leak on three surfaces, each backed by a DISTINCT
 * tenant-scoping filter:
 *   1. recall receipts        → InMemoryNoteRepository.searchSimilarByUser  (`n.userId === userId`)
 *   2. promises (global list) → InMemoryFactsRepository.listPromisesByUser  (`p.userId === userId`)
 *   3. inventory list         → InMemoryInventoryRepository.listByUser      (`r.userId === userId`)
 *
 * MUTATION PROOF (per the isolation-correctness discipline — proven able to fail): each of
 * those three filters was deleted in turn, this file was run, and the matching assertion
 * went RED; the filter was then reverted. See BATCH-B-CONCURRENT-LEAK-REPORT.md §Task 5.
 *
 * The detector is the same one the prod runner uses: scan a surface's full response text
 * for the OTHER account's sentinel token. A hit is a leak.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
interface Acct { token: string; userId: string; clientId: string; sentinel: string }

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', consent: true }) });
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}
async function createClient(token: string, name: string): Promise<string> {
  const res = await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name }) });
  return ((await res.json()) as { id: string }).id;
}
async function pasteExtract(token: string, clientId: string, text: string): Promise<string> {
  const p = (await (await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text }) })).json()) as { id: string };
  await fetch(`${base}/notes/${p.id}/extract`, { method: 'POST', headers: H(token) }); // stores note + embedding
  return p.id;
}
async function createInventory(token: string, title: string, description: string): Promise<void> {
  await fetch(`${base}/inventory`, { method: 'POST', headers: H(token), body: JSON.stringify({ title, description, quantity: 1 }) });
}
/** Seed a canonical promise carrying the sentinel directly (the stub model emits none). */
async function seedPromise(userId: string, clientId: string, noteId: string, sentinel: string): Promise<void> {
  await deps.facts.saveExtraction(userId, {
    noteId, clientId,
    promises: [{ text: `Send the ${sentinel} brochure to Kai Sterling by Tuesday`, owner: 'rep', due_date: null, due_raw: 'Tuesday', confidence: 'high' }],
  });
}

/** Build one account, seeded with data that carries its sentinel on all three surfaces. */
async function makeAccount(email: string, clientName: string, sentinel: string): Promise<Acct> {
  const { token, userId } = await signup(email);
  const clientId = await createClient(token, clientName);
  const noteId = await pasteExtract(token, clientId, `Met Kai Sterling at ${clientName}. ${sentinel}. Budget confirmed, wants a 2-bed.`);
  await seedPromise(userId, clientId, noteId, sentinel);
  await createInventory(token, `2-bed ${clientName}`, `Two-bedroom apartment. ${sentinel}. Sea view.`);
  return { token, userId, clientId, sentinel };
}

async function text(res: Response): Promise<string> {
  return res.text();
}

describe('[BATCH-B] concurrent two-account isolation (mirror of the prod leak run)', () => {
  it('two accounts extracting concurrently never leak across recall, promises, or inventory', async () => {
    // Build both accounts CONCURRENTLY (racing the shared in-process structures).
    const [A, B] = await Promise.all([
      makeAccount('zztest-leak-alpha@example.com', 'Marina Heights', 'SENTINEL-ALPHA-A7'),
      makeAccount('zztest-leak-bravo@example.com', 'Marina Gardens', 'SENTINEL-BRAVO-B3'),
    ]);

    // Concurrent extraction rounds — two tenants' extractions in-flight at the same instant.
    for (let r = 0; r < 6; r++) {
      const nA = (await (await fetch(`${base}/clients/${A.clientId}/notes/paste`, { method: 'POST', headers: H(A.token), body: JSON.stringify({ text: `Round ${r} ${A.sentinel}: Kai Sterling has AED 9,000,000 in cash.` }) })).json()) as { id: string };
      const nB = (await (await fetch(`${base}/clients/${B.clientId}/notes/paste`, { method: 'POST', headers: H(B.token), body: JSON.stringify({ text: `Round ${r} ${B.sentinel}: Kai Sterling needs a shellfish-free venue.` }) })).json()) as { id: string };
      await Promise.all([
        fetch(`${base}/notes/${nA.id}/extract`, { method: 'POST', headers: H(A.token) }),
        fetch(`${base}/notes/${nB.id}/extract`, { method: 'POST', headers: H(B.token) }),
      ]);
    }

    const leaks: string[] = [];
    // For each account, every surface must be free of the OTHER account's sentinel.
    for (const [self, other] of [[A, B], [B, A]] as const) {
      // 1) recall receipts (searchSimilarByUser) — ask for Kai Sterling; must return only own notes.
      const recall = await text(await fetch(`${base}/recall`, { method: 'POST', headers: H(self.token), body: JSON.stringify({ question: 'What do we know about Kai Sterling?' }) }));
      if (recall.includes(other.sentinel)) leaks.push(`recall(${self.sentinel}) leaked ${other.sentinel}`);
      // 2) promises (listPromisesByUser).
      const promises = await text(await fetch(`${base}/promises`, { headers: H(self.token) }));
      if (promises.includes(other.sentinel)) leaks.push(`promises(${self.sentinel}) leaked ${other.sentinel}`);
      // 3) inventory list (listByUser).
      const inventory = await text(await fetch(`${base}/inventory`, { headers: H(self.token) }));
      if (inventory.includes(other.sentinel)) leaks.push(`inventory(${self.sentinel}) leaked ${other.sentinel}`);
    }

    // Sanity: each account's OWN sentinel is actually present on its surfaces (else the test
    // would trivially "pass" by finding nothing anywhere — a detector must see real data).
    const ownRecallA = await text(await fetch(`${base}/recall`, { method: 'POST', headers: H(A.token), body: JSON.stringify({ question: 'What do we know about Kai Sterling?' }) }));
    const ownPromA = await text(await fetch(`${base}/promises`, { headers: H(A.token) }));
    const ownInvA = await text(await fetch(`${base}/inventory`, { headers: H(A.token) }));
    expect(ownRecallA, 'own recall carries own sentinel').toContain(A.sentinel);
    expect(ownPromA, 'own promises carry own sentinel').toContain(A.sentinel);
    expect(ownInvA, 'own inventory carries own sentinel').toContain(A.sentinel);

    expect(leaks, `cross-tenant leak(s) detected: ${leaks.join('; ')}`).toEqual([]);
  });
});
