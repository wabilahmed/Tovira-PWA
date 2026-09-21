# Part A / Task A1 — Book Scan finding identity (report)

The old streaming key `kind|clientId|quote|date` (59cb24f) collides, and `appendFindings` silently drops
the second finding of a collision across polls (and duplicate React keys drop it at render). A dropped
promise is exactly the failure the Book Scan exists to prevent. Fix: the server now emits a **stable,
unique `id` per finding**, and the client keys on **`kind | id`**.

## Does every finding kind map to exactly one fact row? — NO. Two do, two don't.

| Kind | Backing row? | `id` used | Why it is unique + stable |
|---|---|---|---|
| `open_promise` | **Yes — one promise row** | `promise.id` | The promise row's own id (UUID). Unique per promise; independent of quote/date/span. (The facts layer dedupes *identical* text into one row, so two listed promises are always distinct rows with distinct ids.) |
| `upcoming_date` | **Yes — one key_date row** | `keyDate.id` | The key-date row's own id. Unique per date row. |
| `unanswered_question` | **No single row** — it lives inside a note's `extracted.unanswered_questions` array | `` `${noteId}:${index}` `` | Composite of the note id (unique) + the question's index in that note's array. Unique per note even when two questions share text/date; stable because extraction is idempotent per note and preserves array order. |
| `going_cold` | **No backing row** — computed from a client's quiet-gap + its last note | `clientId` | There is exactly **one** going-quiet finding per client, so the client id is a unique, stable key for it. |

The `kind` prefix on the client (`findingId = \`${kind}|${id}\``) guarantees cross-kind uniqueness even
if two different kinds' id-spaces ever coincided (e.g. a `going_cold` client id vs a promise UUID) — they
can't collide because the prefixes differ.

## Why this fixes the two collision cases
- **Case 1 (pre-v0.9.5 null span, two same-client same-date promises):** each is a distinct promise row →
  distinct `promise.id` → distinct key → both render. (Under the old quote key, if two listed items shared
  a receipt quote + date, the second was filtered out on the poll after the first was shown.)
- **Case 2 (one message → two facts of the same kind):** distinct rows (promises) → distinct ids; and two
  unanswered questions in one note → distinct `noteId:index` → both render.

A dropped finding is worse than a reordered one (a reorder is visible, a drop is not), so this is a
correctness fix, not cosmetics.

## Tests + mutation
- Backend (`book-scan-service.test.ts`): two distinct promises (same client/date) get distinct ids; an
  unanswered question is keyed `noteId:index` (two same-text questions → distinct ids); every finding
  carries a non-empty id.
- Frontend (`streaming.test.ts`): `findingId` keys on `kind|id` and is unique even when quote/date
  collide; a distinct finding with the same client/quote/date is **not dropped** when it arrives after
  the first (the real cross-poll drop); two one-message promises both survive; stability (three-poll
  arrival order, no reordering) still holds.
- **Mutation proven + reverted:** reverting `findingId` to the quote-based key turned **3** tests red
  (the uniqueness test + both cross-poll collision tests).

No config, no migration. `id` is an additive field on the existing `GET /book-scan` response.
