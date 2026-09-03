# Inventory — Batch 1 (the store, without matching) — report

`feat(INVENTORY-1)`: the inventory foundation, scoped to everything that does NOT touch the
certified extraction engine, so it ships in parallel with launch prep. **No extraction-prompt
change, no gate run, no new model task class, no Claude calls.** Suite green, typecheck + lint
clean throughout. Six commits.

## What was built, by layer

| Task | Commit | What |
|---|---|---|
| INV-DATA | `779c32e` | 0041 migration (inventory_items + inventory_shares), RLS **FORCE** + composite FKs (IDOR at design time), embedding column, repo (pg + in-memory), read routes proving 404-no-oracle |
| INV-CRUD | `fbc044f` | InventoryService (embed on save), create/edit routes, entitlement (reads gated, create/export open), the Inventory tab (active/disabled display, filter, Locked) |
| INV-SHARE | `1ec40e2` | share/outcome repo + service, bought→decrement→sold_out, duplicate-share warning, WhatsApp-draft share flow |
| INV-LEDGER | `22e0a0d` | `inventory_suggested_bought` ledger event, credited only on `confirmed_suggestion` (dormant until Batch 2), "touched" language, no AED unless entered |
| INV-SURFACE | `e558359` | per-item share history + mark-bought/declined, client-detail Inventory-shared section, match line stubbed+hidden |
| INV-SEED (this) | — | onboarding nudge ("add what you're selling", no reveal), USER-FLOWS + FRONTEND-PAGES, this report |

## Cost — assert: no Claude, embeddings only

Grep of all inventory code (`services/inventory`, `adapters/inventory`, `http/inventory-routes`,
`web/inventory`) for a model client / Claude adapter returns **nothing** — the only "Claude"
strings are comments asserting the absence. The single external call is **one Bedrock embedding
per item on save** (Titan v2, 512-dim, ~AED 0.001), re-run only when title/description change.
Matching is deferred to Batch 2 and is a vector search, not a model call. **Projected impact:
well under AED 0.05/user/month — it does not move the AED 67 Claude ceiling** (it isn't a Claude
cost at all; it's a fractional embeddings cost).

## Isolation — proven at the DB

Both tables carry `user_id` with `ENABLE`/`FORCE ROW LEVEL SECURITY` and the standard
`app.user_id` policy; `inventory_shares` references parents by **composite FK**
(`(user_id,item_id)`, `(user_id,client_id)`), so a cross-tenant reference is a database error,
not a handler check. The SQL validates on boot (per the repo's migration discipline — the unit
suite uses in-memory adapters); a static test asserts 0041 *declares* the net, and route tests
prove the contract (byte-identical 404 for foreign/unknown ids, tenant-scoped lists).

## `docs/` additions — for Wabil to apply (`docs/` is guard-blocked, untouched)

| File | Proposed addition |
|---|---|
| `docs/tovira-user-stories.md` | A new **`[INV-1] Inventory & requirement matching`** epic with Batch-1 stories: **[INV-1a]** *As a rep, I want to list what I have to sell (title, description, quantity), so Tovira can later match it to what clients want.* **[INV-1b]** *…share an item to a client and open a WhatsApp draft, so I follow up in one tap (Tovira never sends).* **[INV-1c]** *…mark a share bought so stock decrements and sells out, or disable/reactivate by setting quantity, so nothing is ever lost.* Mark matching (requirements field, suggestions) as **Batch 2 (post-v0.9 re-certification)**. |
| `docs/tovira-acceptance-tests.md` | An **`### [INV-1] Inventory`** block. **✓ Positive:** add→list; share→WhatsApp draft, nothing sent; bought→decrement→sold_out, still visible; edit qty 0→disabled unlisted; qty>0→reactivated with history. **✗ Negative:** never auto-disable on inference; a disabled item cannot be shared (409, states why); cross-tenant item/client id → identical 404; a lapsed trial → reads 402 but create stays open; duplicate-share warning only when pending shares meet/exceed quantity. |
| `docs/tovira-spec.md` | Under a locked-features or roadmap note, add inventory as a Batch-1 shipped capability and reference `docs/tovira-inventory-spec.md` (draft v0.1) for the full design; note Batch 2 (requirements field → v0.9 → P1-9 re-cert → matching) is gated on the extraction work. |
| `docs/tovira-dev-plan.md` | Add an **Inventory (Batch 1 / Batch 2)** entry: Batch 1 = store + share + lifecycle + surfacing shells (done, no gate); Batch 2 = `requirements` field → v0.9 → full re-certification → matching engine. |

> **Reminder:** the spec doc itself, `tovira-inventory-spec.md`, is currently at the **repo root**
> (the guard blocked me from writing `docs/`); move it in with
> `mv "Tovira inventory spec.md" "docs/tovira-inventory-spec.md"`.

## Agent-owned docs updated directly
`USER-FLOWS.md` — FLOW 29 (add→share→outcome→disable/reactivate), manual-checklist items 31–32,
and inventory rows in the entitlement table. `FRONTEND-PAGES.md` — a new §14 Inventory + the
page-map row. (PROJECT-STATUS.md does not exist; FRONTEND-PAGES.md is its agent-owned equivalent.)

## `test(INV-ISOLATION)` — isolation EXECUTED, not just declared

The Batch-1 report above said isolation was proven "at the DB" but rested on a *static* test that
asserts 0041 **declares** RLS FORCE + composite FKs by reading the SQL file. Declared ≠ enforced —
that exact gap produced the deal-value IDOR. This adds the missing half: the declared SQL is now
**executed** against a real Postgres with the real migrations `0001–0041`, as the non-superuser
`tovira_app` role, and every isolation claim is asserted against what Postgres actually does.

**Where it lives:** `test/integration/inventory-isolation.integration.test.ts` — inside the existing
integration suite (`test/integration/**`, `npm run test:integration`), beside `rls.integration.test.ts`.
Excluded from the unit run; gated on `INTEGRATION_DATABASE_URL` so it skips when no real DB is named.
No production code and **no change to migration 0041** — this batch only observes.

**How it was run.** The Docker daemon was unavailable in this environment (the suite's sibling
`rls.integration.test.ts` self-provisions via `docker compose`; this test instead runs the real
migration set through the real runner against any Postgres named by `INTEGRATION_DATABASE_URL`). It
was executed against a throwaway **Postgres 17 + pgvector** cluster:

```
INTEGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:PORT/<db> \
  npx vitest run --config vitest.integration.config.ts test/integration/inventory-isolation.integration.test.ts
```

**Result: 7/7 passed** (RLS FORCE / WITH CHECK / composite-FK semantics are identical on pg16 and pg17).

| # | Assertion (negative) | Positive control | Observed |
|---|---|---|---|
| 1 | Insert `inventory_shares` as B with **A's client_id** → FK violation | B → B's own client+item **succeeds** (rowCount 1) | **PASS** — pg `23503`, constraint matches `/client/` (an FK error, not null/check/handler) |
| 2 | Insert `inventory_shares` as B with **A's item_id** → FK violation | (control shares the row inserted in #1) | **PASS** — pg `23503`, constraint matches `/item/` |
| 3 | As B, raw `SELECT ... WHERE id = A.row` with **no user_id predicate** on `inventory_items` and `inventory_shares` → 0 rows | As A, same query → **1 row** (proves RLS filters, not an empty table) | **PASS** — 0 rows for B, 1 for A, both tables |
| 4 | `pg_class`: FORCE ROW LEVEL SECURITY in effect | — (catalog fact) | **PASS** — `relrowsecurity` and `relforcerowsecurity` both `true` for both tables |
| 5 | As B, UPDATE and DELETE targeting **A's item by exact id** → 0 rows affected | As A, item's `quantity` still `5` (unchanged) | **PASS** — UPDATE 0, DELETE 0, A's row intact |
| 6 | As B, INSERT `inventory_items` carrying **A's user_id** → rejected | — (the RLS WITH CHECK is the point) | **PASS** — pg `42501` (policy / WITH CHECK violation) |
| 7 | **Cascade:** delete A's client that has a share | item survives | **PASS** — share count 1 → 0, **inventory item survives** (rowCount 1) |

**Cascade behavior (observed, reported explicitly).** Deleting a client removes its `inventory_shares`
row via the declared `ON DELETE CASCADE`, and the `inventory_items` row is **untouched**. This matches
0041's declaration and the product rule "never delete inventory items" — only the share record is lost,
never the item.

**Drift between 0041's declaration and Postgres enforcement: none.** Every property the static test
asserts as *declared* — RLS enabled + FORCED on both tables, the two composite FKs
`(user_id,item_id)`/`(user_id,client_id)`, the WITH CHECK policy, the cascade — is exactly what the
running database enforces.

> **Verdict: inventory tenant isolation is now DEMONSTRATED against real Postgres, not merely declared.**

## Deferred to Batch 2 (explicitly NOT in this batch)
The extraction `requirements` field → prompt **v0.9** → **full P1-9 re-certification**; the
matching engine (both trigger directions, conservative threshold, receipts); the "N clients want
something like this" line; the seeding reveal; the `confirmed_suggestion` ledger path going live.
Nothing in Batch 1 anticipates these by changing the prompt, extraction output, or any gate.
