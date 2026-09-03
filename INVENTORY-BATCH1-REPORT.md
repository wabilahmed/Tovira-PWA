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

## Deferred to Batch 2 (explicitly NOT in this batch)
The extraction `requirements` field → prompt **v0.9** → **full P1-9 re-certification**; the
matching engine (both trigger directions, conservative threshold, receipts); the "N clients want
something like this" line; the seeding reveal; the `confirmed_suggestion` ledger path going live.
Nothing in Batch 1 anticipates these by changing the prompt, extraction output, or any gate.
