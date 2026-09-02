# REMOVE-CARDSCAN — the business-card scan (P4-5) is cut

Owner decision: the business-card scan is removed from the product — the weakest capture
path, and it carried a vision adapter, its own model cost, and an image-based sensitive-data
vector that text redaction cannot cover. Removed cleanly (no dead flag path). Suite **1077
green**, typecheck + lint clean. Three commits: `feat(REMOVE-CARDSCAN-1)`,
`docs(REMOVE-CARDSCAN-2)`, `docs(REMOVE-CARDSCAN-3)`.

> **NOT this task:** the **Tier-1 database card scan** — the one-off compliance query for
> stored payment-card numbers in existing staging data — is untouched and **remains
> outstanding** (see REDACT-REPORT.md §7). `redact.ts` was not modified.

## 1. What was removed, by layer

| Layer | Removed |
|---|---|
| Frontend | `cards/CardScan.tsx` (+ its `<Locked>` gated state) and `cards/CardScan.test.tsx`; `cards/cardsClient.ts` + `.test.ts`; the `<CardScan>` entry on the Clients screen (`App.tsx`) and the `cardsApi`/`CardsClient` wiring; the `.clients-scan` CSS |
| API route | `POST /cards/scan` — `http/cards-routes.ts` + `http/cards.test.ts` |
| Port + adapters | `ports/card-scanner.ts`; `adapters/vision/` entirely (`stub-card-scanner.ts`, `anthropic-card-scanner.ts` + test, `card-scan-prompt.ts`); container/server/index wiring (`createCardScanner`, the `cardScanner` dep, `handleCardRoute`) |
| Config | `'card_scan'` removed from `AI_TASK_CLASSES`; `MODEL_CARD_SCAN` dropped from `.env.example` and the config doc-comment |
| Tests | card-scan unit/integration tests; the `/cards/scan` rows in the entitlement + staging (a5) gated-surface matrices; staging FLOW-16 test (a4) + its orphaned PNG-encoder helpers |

## 2. `docs/` occurrence list — for Wabil to apply (`docs/` is guard-blocked, untouched)

| File · lines | Occurrence | Proposed change |
|---|---|---|
| `docs/tovira-user-stories.md` · **130–131** | `**[P4-5] Business-card scan** — …` + its `- Photo → vision model…` bullet | **Delete both lines.** Do NOT renumber P4-6/P4-7. |
| `docs/tovira-acceptance-tests.md` · **433–443** | the entire `### [P4-5] Business-card scan` block (AC, ✓ Positive, ✗ Negative) | **Delete the block** through the blank line before `### [P4-6]`. |
| `docs/tovira-spec.md` · **127–128** | `### Capture` heading + `- **Business-card scan.** Snap a card…` (the only item under Capture) | **Delete the bullet; delete the now-empty `### Capture` heading** too. |
| `docs/tovira-spec.md` · **286** | `- **Gallery: how smart, beyond cards?** Card-scanning locked. Open: …` | **Reword** — the "card-scanning locked" premise is moot. Suggested: `- **Gallery: how smart?** Open: whether Tovira also *reads* images (whiteboards, sites) or just stores them. Needs a vision/OCR step if yes.` |
| `docs/tovira-spec.md` · **313** | decision-log entry (2026-07-09): "Locked 8 features: …business-card scan… (card-scanning now locked)." | **Do NOT rewrite history.** Leave the 2026-07-09 entry; **add** a new entry: `- **2026-09-02** — Removed the business-card scan (P4-5): weakest capture path + an image-based sensitive-data vector text redaction can't cover. Locked features 8 → 7; the gallery "beyond cards" question is now moot.` |
| `docs/tovira-dev-plan.md` · **109** | `- **Business-card scan** (vision model → structured contact).` (Phase 4) | **Delete the line.** |
| `docs/tovira-dev-plan.md` · **252** | deferred list: "…smart-gallery **beyond business cards**, external calendar…" | **Minor reword** to drop the card framing: "…smart-gallery image reading, external calendar…". Optional. |

**Landing / marketing copy:** checked `apps/web` — **card scanning appears in no web/marketing
copy**; it is referenced only in the `docs/` files above. Nothing to change there.

**Agent-owned files (already updated directly, commit `docs(REMOVE-CARDSCAN-2)`):**
`USER-FLOWS.md` — FLOW 16 marked **REMOVED 2026-09-02** with the reason, number kept and
nothing renumbered (audit trail preserved); its table row, the two manual-checklist items,
the routes-table row, and the now-moot "card scan drops fields" known issue struck through /
marked resolved-by-removal. `FRONTEND-PAGES.md` — Clients scope, functionality bullet,
client-call line, and page-map row de-carded. *(PROJECT-STATUS.md does not exist;
FRONTEND-PAGES.md is its agent-owned equivalent.)*

## 3. Consistency confirmations

- **Routing guard** (`config.routing.test.ts`): updated **deliberately** — the "all classes"
  assertion now lists **seven** classes (was eight), and the per-class-override test uses
  `MODEL_DRAFTS` in place of `MODEL_CARD_SCAN`. Passes.
- **`assertDeployReady`**: iterates `AI_TASK_CLASSES`, so dropping `'card_scan'` from that
  array removes it from the deploy-readiness check automatically — no explicit card_scan
  reference existed in the function. Passes.
- **Cost model / `ModelBudget` / standard-month workload**: there was **no `card_scan` line**
  in the cost model or budget estimates (the scan was a per-request vision call, never in the
  monthly extraction workload), so nothing to remove there — consistent by absence.

## 4. Unaffected (kept, verified)

- **Client `title` / `email` / `phone`** — retained. Still settable manually;
  `clientsClient.create(name, phone?, { title?, email? })` still sends them (covered by
  `clients/clientsClient.test.ts`, kept). 
- **`wa.me` deep link (P4-7 / FLOW 17)** — unaffected; it reads the client `phone`.
- **Gallery (P4-6)** and **Book-Scan share card (P5-6)** — separate features, untouched.

## 5. Orphaned schema — reported, NOT dropped

- **Migration `0032_client_contact.sql`** added `clients.title` and `clients.email` "(P4-5)".
  These columns are **retained, not orphaned** — they remain in use (settable manually, and
  `phone` drives the `wa.me` link). The migration's comment references the now-removed feature,
  but the migration itself is **left as-is** (applied migrations are immutable history).
- **No card-scan-specific table or column** was ever created (the scan saved nothing — it
  returned a proposal only), so there is nothing to drop.

## 6. Still open (unchanged by this batch)

- **Tier-1 database card scan** (stored PAN compliance query on staging) — outstanding, and
  **explicitly not affected** by this removal. Do not mark it done.
