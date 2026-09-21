# Part B — the metering doctrine fix (route extraction/import through the metered sink)

Option A: extraction and import now go through `MeteredModelClient`, so the dominant cost finally reaches
the spend sink — the ledger and the spend cap. This closes a doctrine-level gap.

## The fix
`createExtractionModelRouter` (`container.ts`) now wraps each router client in `MeteredModelClient`
(task class `extraction`; also restored the missing `timeoutMs`). Before, it built **raw**
`AnthropicModelClient`s, so extraction/import `.complete` never reached `spendSink.record` despite the
call deliberately setting `userId` + `spendClass` ("SPEND-CAP", `extraction-service.ts:453`).

## System calls charged to NO account (canary, CI gate)
- **Canary** (`extraction-canary.ts`) passes **no `userId`** → `MeteredModelClient` records nothing to any
  rep's ledger (`metered.ts` gates on `request.userId`). A rep's cap can never be consumed by our
  monitoring. (When B2 adds the per-call event log, the canary is recorded there account-less.)
- **CI gate / eval / scripts** run with **no spend sink set** (`setSpendSink` is boot-only) and no
  `userId` → never billed. The wiring guard (below) allows `eval/` + `scripts/` to build raw clients for
  exactly this reason.

## At-cap extraction queues, never fails — PROVEN for extraction
The sweep skips spend-capped reps. This path was never exercised for extraction (extraction was
unmetered, so it never reached the cap). Now it is, end to end (`extraction-spend-cap.test.ts`): a rep
seeded to the AED 15 trial cap → their captured note stays `pending_extraction` with **`sweepAttempts`
untouched at 0** (the sweep skip, not the extraction gate, which would have bumped it), no facts written;
capture + export + delete still work. **Mutation proven + reverted:** removing the sweep's `canSpend`
skip attempt-bumped the capped note (0 → 2) and turned the test red (+ the two existing sweep skip tests).
(test-deps now wires a real `SpendService` into the sweep's `canSpend` and the extraction `spendGate`,
mirroring prod, so this is testable end to end.)

## Trial cap holds against the now-metered path (`trial-cost.test.ts`)
Cost computed with the SAME pricing the sink uses (`callCostUsd`, Sonnet — trials route to Sonnet):
- **Realistic first fortnight** — 30 imported chats (~AED 0.16 each) + ~5 daily notes/day × 14 (~AED 0.02
  each) = **~AED 6.3**, i.e. **~40% of the AED 15 cap**. The cap holds with real headroom.
- **The cap is not dead weight** — a genuinely heavy/abusive trial (60 big chats + ~10 notes/day) reaches
  **~AED 21 > 15**, at which point extraction queues (the sweep skip). So AED 15 sits between a real rep
  (~6) and abuse. **The AED 15 derivation still holds** against the metered pricing.
- Sensitivity: a *heavy-but-legitimate* trial (40 big chats + ~10 notes/day ≈ AED 15.3) sits right at the
  cap — such a rep would see extraction queue near the end of a fortnight. Rare, and the correct
  degrade-not-break behaviour, but worth knowing the margin is real, not huge, for heavy users.

## How long has the router built raw clients? Since **P5-7 (d168739, 2026-08-01)**.
`BillingModelRouter` + `createExtractionModelRouter` (with raw `make()`) were introduced by
`feat(P5-7): route trial accounts to Sonnet-grade extraction` on **2026-08-01**. Before P5-7, extraction
used `this.model` (a metered `createModelClient`); P5-7 routed it through raw clients and it has bypassed
metering ever since.

**Provenance of the COGS figures (AED 43-48/user/month, AED 67 ceiling):** the durable spend ledger
(`CAP-TRACK`/`SpendService`) landed **2026-09-06 — over a month AFTER** the router was already raw. So the
ledger has **never** contained extraction spend, and the COGS figures **cannot** have come from it. They
must rest on: (a) the extraction **certification runs** (real Sonnet calls in the eval harness, e.g. the
v0.9.1 cert measured **$14.15 / AED 51.96** for the eval set) priced via `callCostUsd`, plus (b) modelled
usage frequency, and (c) `ImportCostMetrics` (in-memory, imports-only). In short: **measured in eval and
modelled, never validated against real production spend.** This fix routes prod extraction into the
ledger, so after ten reps run for a month the COGS figures can finally be checked against real data
(that is exactly what B3 will read).

## Wiring guard (structural, CI)
`wiring-guard.test.ts` now enforces: **no production code constructs a raw `AnthropicModelClient` outside
`MeteredModelClient`** — `eval/` and `scripts/` are the only exempt paths (deliberately unattributed),
and within `container.ts` every `AnthropicModelClient` must have a `MeteredModelClient` wrapper. Same
defect class as an emitter with no caller. **Mutation proven + reverted:** unwrapping the router's
clients made the guard red ("2 AnthropicModelClient but only 1 MeteredModelClient").

## State
Full suite 262 files / 1744 tests pass; typecheck + lint clean. No migration; the router change + guard
are additive. Proceeding to B2 (per-call class recording) — where the canary/gate get recorded
account-less, and per-call tokens/cache land in a durable event log.
