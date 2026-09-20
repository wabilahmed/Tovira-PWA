# Book Scan streams in — Task 1 findings (report only, no edits)

## ⛔ STOP: the aggregate cannot scope to an import. Progress scope is a design question (below).

---

## 1. How the Book Scan fetches and renders today (file:line)
- **Fetches ONCE on mount, no polling** — `BookScan.tsx:27-34`: `useEffect(… [api])` calls `api.scan()`
  a single time; there is no interval and no re-fetch. Confirms the async-batch finding.
- **`scan()`** — `bookScanClient.ts:25-31`: `GET /book-scan`, cookie session, **no import/client/session
  param**. Account-wide (`book-scan-routes.ts:36` → `bookScan.scan(userId, now)`).
- **Render** — `BookScan.tsx:65-80`: findings are **re-grouped by section** (`SECTIONS.map` → filter by
  `kind`) on every render, with **positional keys** (`key={`${item.clientId}-${i}`}`, `i = dealt++`).
- **Server item order** — `book-scan-service.ts:95-175`: items are built **by category** (all promises,
  then per-client unanswered+cold, then upcoming dates), each in the underlying list's order.

## 2. What the Task-4 aggregate exposes — CLIENT-scoped, not import, not account-wide
- Task 4 added `extraction` (`{queued,processing,done,failed,total}`) to **`GET /clients/:id/notes`** —
  it answers "N of M for **one client**", not for a specific import and not account-wide.
- There is **no account-wide extraction aggregate** endpoint. The repo has `listPendingByUser` and
  `listByStatusForUser` (both account-wide) — the raw material for one, but no aggregate today.
- The Book Scan is **account-wide**, so the per-client aggregate does not match its scope.

## 3. Is an import identifiable as a unit? — NO
- Each import is **one `whatsapp_export` note** (`notes-routes.ts:355-371`); the response has **no import
  id / session id** grouping several chats. Three imported chats = three separate notes, with nothing
  tying them together as "this import".
- So progress **cannot be scoped to a specific import**. It can only be account-wide — over all the
  rep's extraction notes, or (more naturally, matching the report's existing `chatsRead`) over all the
  rep's **imported chats** (`whatsapp_export` notes) by state.

## 4. Do findings arrive in a stable order? — NO (re-fetch reorders)
- Server order is **by category**, so a newly-extracted fact lands **in the middle** of its category
  (e.g. a new promise appears among the promises, above later-arrived cold findings), not at the end.
- The UI **re-groups by section every render** with **positional keys**, so a naive re-fetch-and-replace
  would **reorder** the visible list. **Append-don't-resort therefore needs a flat, arrival-ordered list
  with a stable per-finding identity** (findings have no id today — identity must be derived, e.g.
  `kind|clientId|quote|date`). This is a real render change, and it is the direct consequence of your
  "append, never resort" requirement — not a new product decision.

## 5. Zero findings — "still scanning" is NOT distinguishable from "nothing found" today
- `BookScan.tsx:39` — `if (report.isEmpty)` renders the honest empty state ("What your book has been
  hiding" + message). There is **no progress and no scanning indicator**, so mid-scan-zero looks
  **identical** to done-empty. This is exactly the Task 2 hazard: a rep who opens the scan before the
  first chat extracts sees "nothing found" when it simply isn't finished.

---

## The design question (why I stopped)
The scan is **account-wide and re-entrant** (a persistent nav tab, re-run on every mount — `nav.ts:35,59`,
`BookScan.tsx:28`), and there is **no import-unit identifier**. So progress **cannot scope to a specific
import**. The only progress it can honestly show is **account-wide** — how many of the rep's imported
chats (`whatsapp_export` notes) are extracted vs still queued/processing/failed.

- **On day one (the target wow moment)** a brand-new rep has no prior notes, so account-wide progress
  **equals** the import: "0 of 3 → 3 of 3 chats analysed". Correct and matches the rep's mental model.
- **For a returning rep** who already has extracted chats and imports one more, account-wide progress
  reads e.g. "50 of 51" — honest about the account-wide scan, but it counts their history, not just the
  new import. This is the "counts unrelated notes" case the STOP guards.

Because the scan is account-wide, account-wide progress is **not counting unrelated notes** — every note
it counts is one the scan actually reads — but it also **cannot answer "N of M for THIS import"** the way
the requirement's example ("imports three chats") implies. That gap is the decision.

**Two ways forward — your call:**
- **(A) Account-wide progress over imported chats** (recommended). Add an account-wide chat aggregate
  (queued/processing/done/failed over `whatsapp_export` notes) to the scan. Correct for an account-wide
  scan, equals the import on day one (the wow moment), no new data model. Cost: a returning rep sees
  whole-book progress, not per-import. Small, and arguably honest for an account-wide scan.
- **(B) Import-scoped progress.** Introduce an import/seeding-session identifier, thread it from import →
  notes → scan progress, and scope "N of M" to that session. Matches the requirement's example exactly,
  but is a larger change (new field + migration + threading) and is out of the "don't change extraction/
  the sweep" spirit — it touches the import path and data model.

I recommend **(A)**; it serves the day-one streaming wow moment, which is the point of the batch. **I
have not proceeded to Task 2.** Which scope — A or B?
