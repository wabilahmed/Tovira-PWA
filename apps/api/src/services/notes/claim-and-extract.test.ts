import { describe, it, expect } from 'vitest';
import { createClaimAndExtract } from './claim-and-extract.js';
import { NoteSweepService } from './note-sweep-service.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import type { ExtractOutcome } from '../extraction/extraction-service.js';
import { EMERGENCY_MAX_MESSAGES } from '../import/long-chat.js';

async function seedPending(notes: InMemoryNoteRepository, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const rec = await notes.create('u', { clientId: 'c', source: 'whatsapp_export', rawText: `chat ${i}`, audioKey: null, status: 'pending_extraction' });
    ids.push(rec.id);
  }
  return ids;
}

describe('[BULK-IMPORT] atomic claim (RULING 2 item 2)', () => {
  it('the orchestrator and the sweep racing the same 10 notes extract each EXACTLY once', async () => {
    const notes = new InMemoryNoteRepository();
    const ids = await seedPending(notes, 10);
    const counts = new Map<string, number>();
    const extract = async (_u: string, id: string): Promise<ExtractOutcome> => {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      await notes.update('u', id, { status: 'extracted' }); // leaves 'extracting'
      return { status: 'extracted' };
    };
    const drain = createClaimAndExtract({ claim: (u, id, now) => notes.claimForExtraction(u, id, now), extract });
    // Two drainers (sweep + orchestrator) hit every note concurrently.
    await Promise.all([...ids, ...ids].map((id) => drain('u', id, 't')));
    for (const id of ids) expect(counts.get(id)).toBe(1); // each extracted once — zero duplicates
  });

  it('a note claimed by one worker cannot be claimed by another (until it finishes)', async () => {
    const notes = new InMemoryNoteRepository();
    const [id] = await seedPending(notes, 1);
    expect(await notes.claimForExtraction('u', id!, 1000)).toBe(true);
    expect(await notes.claimForExtraction('u', id!, 1000)).toBe(false); // already extracting
  });

  it('reclaims a note stuck in extracting after the timeout; a fresh claim is NOT reclaimed', async () => {
    const notes = new InMemoryNoteRepository();
    const [id] = await seedPending(notes, 1);
    await notes.claimForExtraction('u', id!, 1_000); // claimed at t=1000
    const STALE = 60_000;
    expect(await notes.reclaimStaleExtracting('u', 1_000 + STALE - 1, STALE)).toBe(0); // not yet stale
    expect((await notes.findByIdForUser('u', id!))?.status).toBe('extracting');
    expect(await notes.reclaimStaleExtracting('u', 1_000 + STALE + 1, STALE)).toBe(1); // crash recovery
    expect((await notes.findByIdForUser('u', id!))?.status).toBe('pending_extraction');
    expect(await notes.claimForExtraction('u', id!, 2_000)).toBe(true); // claimable again
  });
});

// [RULING 2 item 6] Single-chat import drains through the same sweep → claimAndExtract path: the START
// is gated (the sweep's canSpend), and once a note is claimed it is 'extracting' and runs with
// forceAllowance — so once started it finishes, with the gate absorbing any overshoot.
describe('[BULK-IMPORT] single-chat import: only the start is gated', () => {
  function harness(canSpend: boolean) {
    const notes = new InMemoryNoteRepository();
    const seen: { status?: string; force?: boolean } = {};
    const extractNote = async (u: string, id: string, _t: string, opts?: { forceAllowance?: boolean }): Promise<ExtractOutcome> => {
      const n = await notes.findByIdForUser(u, id);
      seen.status = n?.status; // the note's status AT extraction time
      seen.force = opts?.forceAllowance;
      await notes.update(u, id, { status: 'extracted' });
      return { status: 'extracted' };
    };
    const claimAndExtract = createClaimAndExtract({ claim: (u, id, now) => notes.claimForExtraction(u, id, now), extract: extractNote });
    const sweep = new NoteSweepService({
      allUserIds: async () => ['u'],
      listPending: (u) => notes.listPendingByUser(u).then((r) => r.map((n) => ({ id: n.id, status: n.status, sweepAttempts: n.sweepAttempts }))),
      transcribe: async () => {},
      extract: (u, id, t) => claimAndExtract(u, id, t).then(() => undefined),
      setAttempts: (u, id, n) => notes.update(u, id, { sweepAttempts: n }),
      markNeedsReview: async () => {},
      canSpend: async () => canSpend,
    });
    return { notes, sweep, seen };
  }

  it('the start is gated: an exhausted account leaves the imported chat pending, unextracted', async () => {
    const { notes, sweep, seen } = harness(false); // canSpend false = exhausted
    const n = await notes.create('u', { clientId: 'c', source: 'whatsapp_export', rawText: 'hi', audioKey: null, status: 'pending_extraction' });
    await sweep.sweep('2026-10-04');
    expect((await notes.findByIdForUser('u', n.id))?.status).toBe('pending_extraction'); // untouched
    expect(seen.status).toBeUndefined(); // extraction never started
  });

  // [P79-EMERGENCY · owner, 19 Nov] "Remove the allowance exemption for chats that have started." A started chat no
  // longer runs with forceAllowance (a 28,357-message chat ran for hours past the AED 45 cap). The pin moves with this note.
  it('once started the chat is claimed (extracting) and runs WITHOUT the allowance exemption', async () => {
    const { notes, sweep, seen } = harness(true);
    const n = await notes.create('u', { clientId: 'c', source: 'whatsapp_export', rawText: 'hi', audioKey: null, status: 'pending_extraction' });
    await sweep.sweep('2026-10-04');
    expect(seen.status).toBe('extracting'); // claimed BEFORE extraction — a started chat
    expect(seen.force).not.toBe(true); // [P79-EMERGENCY] no allowance bypass: the cap stops it at its next call
    expect((await notes.findByIdForUser('u', n.id))?.status).toBe('extracted');
  });
});

// [P79-EMERGENCY · owner, 19 Nov] A stored import over the emergency limit (the parked 28,357-message chat, or anything
// re-queued by "Try again") is never claimed or read: set aside (needs_review) with no model call, every time.
describe('[P79-EMERGENCY] a stored note over the limit is set aside, never read', () => {
  function guarded(count: number) {
    const notes = new InMemoryNoteRepository();
    const calls: string[] = [];
    const claimAndExtract = createClaimAndExtract({
      claim: async (u, id, now) => { calls.push('claim'); return notes.claimForExtraction(u, id, now); },
      extract: async () => { calls.push('extract'); return { status: 'extracted' }; },
      tooLong: async () => count > EMERGENCY_MAX_MESSAGES,
      setAside: async (u, id) => { calls.push('setAside'); await notes.update(u, id, { status: 'needs_review' }); },
    });
    return { notes, calls, claimAndExtract };
  }
  it('over the limit: set aside, never claimed, no extraction (no model call)', async () => {
    const { notes, calls, claimAndExtract } = guarded(EMERGENCY_MAX_MESSAGES + 1);
    const n = await notes.create('u', { clientId: 'c', source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'pending_extraction' });
    expect(await claimAndExtract('u', n.id, '2026-11-19')).toEqual({ status: 'too_long' });
    expect(calls).toEqual(['setAside']);
    expect((await notes.findByIdForUser('u', n.id))?.status).toBe('needs_review');
    // re-queued (Try again), it is set aside again: still never read
    await notes.update('u', n.id, { status: 'pending_extraction', sweepAttempts: 0 });
    await claimAndExtract('u', n.id, '2026-11-19');
    expect(calls).toEqual(['setAside', 'setAside']);
  });
  it('NEGATIVE: exactly the limit is claimed and read as before', async () => {
    const { notes, calls, claimAndExtract } = guarded(EMERGENCY_MAX_MESSAGES);
    const n = await notes.create('u', { clientId: 'c', source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'pending_extraction' });
    await claimAndExtract('u', n.id, '2026-11-19');
    expect(calls).toEqual(['claim', 'extract']);
  });
});
