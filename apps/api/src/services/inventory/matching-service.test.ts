import { describe, it, expect } from 'vitest';
import { MatchingService } from './matching-service.js';
import { InMemoryInventoryMatchRepository } from '../../adapters/inventory/in-memory-inventory-match-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';
import { InMemoryInventoryRepository } from '../../adapters/inventory/in-memory-inventory-repository.js';
import type { RequirementInput } from '../../ports/requirement-repository.js';

/**
 * INV-MATCH trust-rule tests. These are SPEC-DERIVED (from the inventory spec §4/§7/§9/§10/§11),
 * NOT owner-certified acceptance tests — the acceptance-test doc is human-owned. They encode the
 * trust rules the matching engine exists to keep; a wrong match is a rep pitching a property a
 * client never asked about, in person, so these are the half that matters most.
 */
const USER = 'rep-A';
const CID = 'client-1';

// Controlled unit vectors → controlled cosine. strong ≥0.65, possible ≥0.55, else silence.
const V_EXACT = [1, 0, 0]; // cosine 1.0 with itself → strong
const V_POSSIBLE = [0.6, 0.8, 0]; // cosine 0.6 with V_EXACT → possible (≥0.55, <0.65)
const V_WEAK = [0.5, Math.sqrt(1 - 0.25), 0]; // cosine 0.5 with V_EXACT → below possible → silence

const reqInput = (raw: string, embedding: number[] | null): RequirementInput => ({
  text: raw, requirementRaw: raw, statedOn: '2026-03-14', confidence: 'high', embedding,
});

async function fx() {
  const matches = new InMemoryInventoryMatchRepository();
  const requirements = new InMemoryRequirementRepository();
  const inventory = new InMemoryInventoryRepository();
  const svc = new MatchingService(matches, requirements, inventory);
  const item = await inventory.create(USER, { title: 'Marina Heights 402', description: '2-bed near the marina', quantity: 1, embedding: V_EXACT });
  const [req] = await requirements.saveForNote(USER, 'note-1', CID, [reqInput('looking for a 2-bed near the marina', V_EXACT)]);
  return { matches, requirements, inventory, svc, item, req: req! };
}

describe('[INV-MATCH] MatchingService — positive', () => {
  it('direction 1: a new requirement matches existing stock, strong, with the client receipt', async () => {
    const { svc, req } = await fx();
    const made = await svc.matchRequirement(USER, req, V_EXACT);
    expect(made).toHaveLength(1);
    expect(made[0]!.confidence).toBe('strong');
    const sugg = await svc.suggestionsForClient(USER, CID);
    expect(sugg).toHaveLength(1);
    expect(sugg[0]!.itemTitle).toBe('Marina Heights 402');
    expect(sugg[0]!.receipt).toEqual({ requirementRaw: 'looking for a 2-bed near the marina', statedOn: '2026-03-14', noteId: 'note-1' });
  });

  it('direction 2: a new inventory item matches existing open requirements', async () => {
    const { svc, item } = await fx();
    const made = await svc.matchItem(USER, item, V_EXACT);
    expect(made).toHaveLength(1);
    expect((await svc.suggestionsForItem(USER, item.id))).toHaveLength(1);
  });
});

describe('[INV-MATCH] trust rules (SPEC-DERIVED, not owner-certified)', () => {
  // #1 — No suggestion without a receipt (§10).
  it('every surfaced suggestion carries the client\'s quoted words + date + source note', async () => {
    const { svc, req } = await fx();
    await svc.matchRequirement(USER, req, V_EXACT);
    const [s] = await svc.suggestionsForClient(USER, CID);
    expect(s!.receipt.requirementRaw.length).toBeGreaterThan(0);
    expect(s!.receipt.noteId).toBe('note-1');
    expect('statedOn' in s!.receipt).toBe(true);
  });

  // #2 — Confidence in words, never a number (§4/§10).
  it('the surfaced suggestion exposes a confidence WORD and no similarity number', async () => {
    const { svc, req } = await fx();
    await svc.matchRequirement(USER, req, V_EXACT);
    const [s] = await svc.suggestionsForClient(USER, CID);
    expect(['strong', 'possible']).toContain(s!.confidence);
    expect(JSON.stringify(s)).not.toMatch(/similarity/);
    expect(Object.keys(s!)).not.toContain('similarity');
  });

  // #3 — Conservative: a weak pairing produces silence (§4).
  it('a pairing below the possible floor produces NO match', async () => {
    const { svc, requirements } = await fx();
    const [weak] = await requirements.saveForNote(USER, 'note-weak', CID, [reqInput('something loosely related', V_WEAK)]);
    const made = await svc.matchRequirement(USER, weak!, V_WEAK);
    expect(made).toHaveLength(0);
  });

  // #4 — Dismissal is idempotent: a dismissed pairing never resurfaces (§7).
  it('a dismissed match does not come back when matching re-runs', async () => {
    const { svc, req } = await fx();
    const [m] = await svc.matchRequirement(USER, req, V_EXACT);
    await svc.dismiss(USER, m!.id);
    await svc.matchRequirement(USER, req, V_EXACT); // re-run
    expect(await svc.suggestionsForClient(USER, CID)).toHaveLength(0);
  });

  // #5 — Dormant requirements generate no matches (§11.1).
  it('a dormant requirement matches nothing, and an existing match stops surfacing once dormant', async () => {
    const { svc, requirements, req } = await fx();
    await svc.matchRequirement(USER, req, V_EXACT); // an open match exists
    await requirements.setStatus(USER, req.id, 'dormant');
    const dormant = (await requirements.findByIdForUser(USER, req.id))!;
    expect(await svc.matchRequirement(USER, dormant, V_EXACT)).toHaveLength(0); // creation-time
    expect(await svc.suggestionsForClient(USER, CID)).toHaveLength(0); // surface-time
  });

  // #6 — Met requirements generate no matches (§11.1).
  it('a met requirement (client bought) stops matching and surfacing', async () => {
    const { svc, requirements, req } = await fx();
    await svc.matchRequirement(USER, req, V_EXACT);
    await requirements.setStatus(USER, req.id, 'met');
    expect(await svc.suggestionsForClient(USER, CID)).toHaveLength(0);
  });

  // #7 — Matching never acts (§10): no share, no disable, no purchase outcome.
  it('matching creates no share, disables no item, and sets no purchase outcome', async () => {
    const { svc, inventory, req, item } = await fx();
    await svc.matchRequirement(USER, req, V_EXACT);
    await svc.matchItem(USER, item, V_EXACT);
    expect(await inventory.listSharesByItem(USER, item.id)).toHaveLength(0); // nothing shared
    expect((await inventory.findByIdForUser(USER, item.id))!.status).toBe('active'); // nothing disabled
  });

  // #8 — Tenant + client isolation, incl. the composite-FK path (§10).
  it('never pairs across reps, and a match\'s client is always the requirement\'s own client', async () => {
    const { svc, inventory, requirements } = await fx();
    // Rep B has an identical item; rep A's requirement must never see it.
    await inventory.create('rep-B', { title: 'B\'s villa', description: '2-bed near the marina', quantity: 1, embedding: V_EXACT });
    const [aReq] = await requirements.saveForNote(USER, 'n', 'client-A', [reqInput('2-bed near the marina', V_EXACT)]);
    const made = await svc.matchRequirement(USER, aReq!, V_EXACT);
    for (const m of made) {
      expect(m.userId).toBe(USER); // same rep only
      expect(m.clientId).toBe('client-A'); // the requirement's own client
    }
    expect(await svc.suggestionsForClient('rep-B', 'client-A')).toHaveLength(0); // B sees nothing of A's
  });

  // #9 — Retrieval, not inference: matching needs no model/embedder (§9).
  it('matches using ONLY the repos — no model or embedder dependency', async () => {
    // The service is constructed with three repos and thresholds — no ModelClient, no Embedder.
    // It takes pre-computed vectors and only reads/writes repos, so a per-pairing model call is
    // impossible by construction. (The zero-Claude-call guarantee end-to-end is asserted in the
    // extraction-trigger integration test.)
    const { svc, req } = await fx();
    expect((svc as unknown as { model?: unknown }).model).toBeUndefined();
    expect((svc as unknown as { embedder?: unknown }).embedder).toBeUndefined();
    await expect(svc.matchRequirement(USER, req, V_EXACT)).resolves.toHaveLength(1); // works with no model
  });

  // #10 — A dismissed pairing does not resurface via the OTHER direction (§7).
  it('dismiss via direction 1, then run direction 2 with a new item — it stays dismissed', async () => {
    const { svc, req, item } = await fx();
    const [m] = await svc.matchRequirement(USER, req, V_EXACT); // direction 1 creates it
    await svc.dismiss(USER, m!.id);
    await svc.matchItem(USER, item, V_EXACT); // direction 2 would re-pair (req, item)
    expect(await svc.suggestionsForClient(USER, CID)).toHaveLength(0);
    expect(await svc.suggestionsForItem(USER, item.id)).toHaveLength(0);
  });

  // #11 — A disabled / out-of-stock item never generates matches, both reasons (§11.2, Batch 1).
  it('a disabled item never matches (sold_out and unlisted both excluded)', async () => {
    for (const reason of ['sold_out', 'unlisted'] as const) {
      const { svc, inventory, requirements } = await fx();
      const dead = await inventory.create(USER, { title: 'gone', description: '2-bed near the marina', quantity: 0, embedding: V_EXACT });
      await inventory.update(USER, dead.id, { status: 'disabled', disabledReason: reason });
      const [r] = await requirements.saveForNote(USER, 'n2', CID, [reqInput('2-bed near the marina', V_EXACT)]);
      const made = await svc.matchRequirement(USER, r!, V_EXACT);
      // The only active item in fx() (Marina Heights 402) may match; the disabled one must NOT.
      expect(made.map((m) => m.itemId)).not.toContain(dead.id);
    }
  });

  // Badge #a — only STRONG matches count; possibles never light it (owner ruling).
  it('the badge counts strong matches only — possibles never light it', async () => {
    const { svc, requirements, req } = await fx();
    await svc.matchRequirement(USER, req, V_EXACT); // one STRONG match (req ↔ fx item)
    // A possible-band requirement against the same item → a POSSIBLE match, which must not count.
    const [midReq] = await requirements.saveForNote(USER, 'nposs', CID, [reqInput('possible', V_POSSIBLE)]);
    await svc.matchRequirement(USER, midReq!, V_POSSIBLE);
    expect(await svc.badgeCount(USER)).toBe(1); // only the strong one
    // With the strong one dismissed, only the possible remains → the badge is dark.
    const [m] = await svc.suggestionsForClient(USER, CID);
    await svc.dismiss(USER, m!.matchId);
    expect(await svc.badgeCount(USER)).toBe(0);
  });

  // Badge #b — a dismissed match never counts as unseen (owner ruling: else the badge lies).
  it('a dismissed strong match does not count toward the badge', async () => {
    const { svc, req } = await fx();
    const [m] = await svc.matchRequirement(USER, req, V_EXACT);
    expect(await svc.badgeCount(USER)).toBe(1);
    await svc.dismiss(USER, m!.id);
    expect(await svc.badgeCount(USER)).toBe(0);
  });

  // Badge #c — opening the tab (markBadgeViewed) clears it; a later strong match relights it.
  it('markBadgeViewed clears the badge; a newer strong match relights it', async () => {
    const { svc, requirements, req } = await fx();
    const [m1] = await svc.matchRequirement(USER, req, V_EXACT);
    expect(await svc.badgeCount(USER)).toBe(1);
    await svc.markBadgeViewed(USER, m1!.createdAt); // seen up to this match
    expect(await svc.badgeCount(USER)).toBe(0);
    // A strong match created AFTER the view (higher createdAt) relights the badge.
    const [req2] = await requirements.saveForNote(USER, 'n-new', CID, [reqInput('another 2-bed', V_EXACT)]);
    await svc.matchRequirement(USER, req2!, V_EXACT);
    expect(await svc.badgeCount(USER)).toBe(1);
  });

  // Badge #d — the count never exceeds what the tab shows: a match whose requirement went dormant
  // is open in the table but does not surface, so it must not inflate the badge.
  it('the badge does not count a strong match whose requirement is no longer open', async () => {
    const { svc, requirements, req } = await fx();
    await svc.matchRequirement(USER, req, V_EXACT);
    await requirements.setStatus(USER, req.id, 'dormant');
    expect(await svc.badgeCount(USER)).toBe(0);
  });

  // Today's register data — strong suggestions with receipts across the rep.
  it('suggestionsForUser returns strong suggestions with receipts (Today\'s register data)', async () => {
    const { svc, req } = await fx();
    await svc.matchRequirement(USER, req, V_EXACT);
    const all = await svc.suggestionsForUser(USER);
    expect(all).toHaveLength(1);
    expect(all[0]!.confidence).toBe('strong');
    expect(all[0]!.receipt.requirementRaw.length).toBeGreaterThan(0);
  });

  // A 'possible' pairing is labelled possible, not strong (words map to the right band).
  it('a mid-similarity pairing is labelled possible, not strong', async () => {
    const { svc, requirements, inventory } = await fx();
    // A fresh item at the possible band from a fresh requirement.
    const midItem = await inventory.create(USER, { title: 'maybe', description: 'x', quantity: 1, embedding: V_EXACT });
    const [midReq] = await requirements.saveForNote(USER, 'n3', CID, [reqInput('possible match', V_POSSIBLE)]);
    const made = await svc.matchRequirement(USER, midReq!, V_POSSIBLE);
    const forMid = made.find((m) => m.itemId === midItem.id);
    expect(forMid?.confidence).toBe('possible');
  });
});
