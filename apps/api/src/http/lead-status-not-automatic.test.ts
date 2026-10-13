import { describe, it, expect } from 'vitest';
import { buildInMemoryDeps } from './test-deps.js';
import { OutcomeInferenceService } from '../services/outcomes/outcome-inference-service.js';

// [LEAD-STATUS] The product's trust rule: a client's lead_status is the rep's MANUAL pipeline label,
// and NOTHING automatic may ever write it — not extraction, not bulk import, not the going-cold /
// outcome-inference scan. The ONLY writer in the whole system is the rep-tap route
// (POST /clients/:id/lead-status). This test drives all three automatic flows end-to-end against the
// in-memory stack and asserts the label never moves off Unsorted (null) on its own.
//
// It also covers "every new AND imported client defaults to Unsorted": the bulk import below creates a
// brand-new client, and we assert that one is Unsorted too.
describe('[LEAD-STATUS] nothing automatic ever sets a client lead_status', () => {
  const androidChat = (rep: string, other: string): string =>
    [`13/07/2019, 1:00 am - ${rep}: hi`, `13/07/2019, 1:01 am - ${other}: hello, about the Marina quote. You promised the brochure by Friday.`].join('\n');

  it('stays Unsorted through extraction, bulk import, and the going-cold / outcome-inference scan', async () => {
    const deps = buildInMemoryDeps();
    const userId = 'rep-1';
    const today = new Date().toISOString().slice(0, 10);

    // A client the rep has NOT sorted — its lead_status is the untouched default (null = Unsorted).
    const client = await deps.clients.create(userId, 'Meridian Corp');
    expect(client.leadStatus).toBeNull();

    // (1) EXTRACTION — a pasted message about this client runs through the real extraction service.
    const note = await deps.notes.create(userId, {
      clientId: client.id,
      source: 'paste',
      rawText: 'Call with Meridian. They want a revised quote and I promised the brochure by Friday.',
      audioKey: null,
      status: 'pending_extraction',
    });
    await deps.extraction.extractNote(userId, note.id, today);

    // (2) BULK IMPORT — importing a chat creates a BRAND-NEW client ("Layla"). A new/imported client
    //     must also default to Unsorted.
    expect(deps.bulkImport).toBeDefined();
    await deps.bulkImport!.importConfirmed(
      userId,
      [{ name: 'layla.txt', content: androidChat('Wabil', 'Layla') }],
      [{ fileName: 'layla.txt', action: 'new', name: 'Layla' }],
      today,
    );

    // (3) RISK SCAN — push both clients well past the silence thresholds, then run BOTH scheduled
    //     passes: the going-cold alert scan and the deterministic outcome-inference recompute.
    const all = await deps.clients.listByUser(userId);
    const longAgo = Date.now() - 200 * 24 * 60 * 60 * 1000; // ~200 days of silence
    for (const c of all) await deps.clients.setLastTouched(userId, c.id, longAgo);

    await deps.scan.runAll(userId, Date.now(), deps.scanConfig);
    await new OutcomeInferenceService({
      clients: deps.clients,
      allUserIds: async () => [userId],
      thresholdDays: 90,
    }).recompute(Date.now());

    // ASSERT — after extraction, import, and the full risk scan, EVERY client is still Unsorted.
    // (The outcome-inference pass is expected to have moved `outcome` to lost_inferred — that proves the
    //  automatic machinery really ran — but it must not have touched lead_status.)
    const afterAll = await deps.clients.listByUser(userId);
    expect(afterAll.length).toBeGreaterThanOrEqual(2); // Meridian + the imported Layla
    for (const c of afterAll) {
      expect(c.leadStatus).toBeNull();
      expect(c.leadStatusChangedAt).toBeNull();
    }
    // Sanity: the inference machinery genuinely ran (so the null above is a real guarantee, not a no-op).
    expect(afterAll.some((c) => c.outcome === 'lost_inferred')).toBe(true);
  });
});
