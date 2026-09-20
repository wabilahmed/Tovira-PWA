# Async extraction — Task 1 findings (report only, no edits)

## ⛔ STOP condition hit: the sweep, as built, CANNOT keep up with day-one concurrency.
This is a capacity decision to make **before** any design (Task 3). Details in §5, options at the end.

---

## 1. The current sync extract path, end to end

- **Client** captures: `POST /clients/:id/notes/paste` (`notes-routes.ts:184-190`) or `/voice` or
  `/import` → the note is **persisted `pending_extraction`** immediately (paste at `:189`; import at
  `notes-routes.ts:363`). So the note is already queued at capture; nothing is lost even today.
- **Client then forces extraction:** `POST /notes/:id/extract` (`notes-routes.ts:438-448`) calls
  **`deps.extraction.extractNote(userId, noteId, todayIso())` synchronously in the request path**
  (`:445`), then re-reads the note and returns `{ note, ...outcome }` (`:447`). The model call happens
  **inside the HTTP request**.
- Inside `extractNote` (`extraction-service.ts:226+`): gates (verification `:~231`, trial ceiling
  `:233`, spend cap `:240`) run first, then the **model call loop** (`:268-287`, up to 2 attempts,
  `MODEL_TIMEOUT_MS` default **300s**), then persists `extracted` / `needs_review`.
- **Web driver:** `App.tsx:508-530` `refresh()` lists notes once, fires `/transcribe` + `/extract` for
  pending notes, re-lists **once**. `clientsClient.ts:211` reads only `{ status }` from `/extract`
  (never the facts). So the client already treats extraction as status-only — good — but it **drives it
  synchronously and re-lists exactly once** (no polling; see §3).

**Why it 504s under load:** each sync `/extract` holds a request/connection and a container slot for the
model's duration. The ALB times out the *client* at ~30s, but the server keeps running to
`MODEL_TIMEOUT_MS`. Under N concurrent reps, held slots starve the next request → cascading slowness
(BATCH B: 2/24 at just two accounts). Raising the ALB timeout only makes the rep wait longer for the
same failure.

## 2. The existing sweep

- **What:** `NoteSweepService` (`note-sweep-service.ts`). For each `allUserIds()`, for each
  `listPendingByUser` note, it transcribes (`pending_transcription`) or extracts
  (`pending_extraction`), bumping `sweepAttempts` first (`:61`); after **`DEFAULT_MAX_SWEEP_ATTEMPTS`=5**
  (`:37`) it marks the note **`needs_review`** (terminal) rather than looping forever.
- **How often:** registered as job `notes-sweep`, `intervalMs: 15_000` (`index.ts:315`) — but the
  `ScheduledBrain` tick is **`tickMs = 30_000`** (`scheduled-brain.ts:39`; `index.ts` does not override
  it), so the sweep is checked at most **every ~30s**.
- **Concurrency:** the whole sweep runs **under one global advisory lock** (`scheduled-brain.ts:86`,
  `withLock(job.lockKey)`), so **exactly one container** ever sweeps, and within a pass every note is
  processed **strictly sequentially** (`note-sweep-service.ts:48-73`) — no batching, no per-rep
  parallelism, no fairness/ordering. A long pass can't overlap the next (the lock is still held).
- **What marks a note as needing it:** capture creates notes `pending_extraction`/`pending_transcription`
  (paste `:189`, import `:363`, voice → pending_transcription). Those statuses ARE the queue.
- **How a note lands there after a 504:** it was already `pending_extraction` from capture. The client's
  504 is just a dropped connection; the server-side `extractNote` usually still completes and marks it
  `extracted`/`needs_review`. If the server also died mid-call, the note stays `pending_extraction` and
  the sweep retries it. So the note isn't lost — but the **client never learns** (see §3).

## 3. What the client shows while waiting, and on failure

- **Waiting:** `NotesTimeline.tsx:5-10,37` shows an inline amber `analysing…` / `transcribing…` label —
  the only progress indicator, no spinner, **no polling anywhere in the app** (the sole `setInterval` is
  the recording timer). `refresh()` re-lists once per action/mount.
- **On failure:** `clientsClient.ts:212-217` **swallows a non-200 `/extract` (a 504) and returns `{}`** —
  the note stays `pending_extraction`, so the UI shows **`analysing…` forever: looks stuck, not failed.**
  There is **no distinct UI for `needs_review` or `import_failed`** — a terminal-failed note renders as
  an ordinary completed note. (Import errors are the one exception — surfaced as an alert in
  `ImportChat.tsx`.)
- **Consequence for async:** the moment extraction moves off the request path, the current UI will sit on
  `analysing…` indefinitely, because nothing re-fetches as the sweep drains. **Polling / visible state is
  a prerequisite, not a nicety** (Task 4).

## 4. Downstream assuming synchronous completion

- **Book Scan** (`book-scan-service.ts`) computes **on read** from stored clients/notes/facts, and
  `chatsRead` counts `whatsapp_export` notes. So at the *service* level it already tolerates async — it
  returns whatever has been extracted so far (partial), never assuming completion. **But the *client*
  assumes completion:** `BookScan.tsx:27-34` calls `GET /book-scan` **once on mount**, treats the result
  as final, and never re-fetches as the sweep drains (directly contradicting the async-import comment at
  `clientsClient.ts:154-155`). Since import is *already* 202-async today, the wow-moment screen can
  already show an empty/partial scan and never update. This is the highest-concurrency path and the most
  exposed.
- **No code reads the `/extract` response body's facts** (confirmed): everything re-fetches via
  `listNotes` / `getBrief` / `book-scan`. So the only sync assumption is *timing* (present-at-mount), not
  *shape*.

## 5. Can the sweep keep up with ten simultaneous large imports? — NO

Throughput model: **1 note at a time · 1 container · checked every ~30s · sequential · no fairness.**
Day-one: ~10 reps × ~20–30 chats ≈ **200–300 pending notes**. Import extraction latency ~5–30s each
(the measured 5,615-message import ≈ AED 2.3–2.5 warm, tens of seconds of model time). Sequential drain
≈ **200–300 × ~10s ≈ 30–50 minutes** for the fleet. In the **first three minutes** (the trial's
judged window) the sweep clears ~**18 notes** — a given rep's Book Scan is not ready for many minutes.
And there is **no fairness**: one rep's big import is processed before another rep's single note even
starts (`for user … for note …` order), so a small note can wait behind a whole book.

**This is the capacity decision the batch names.** Freeing the request path (Task 2) stops the 504s but
moves the load onto a processor that is single-threaded and single-container. Task 3 cannot be designed
until the sweep's capacity model is chosen.

## 6. Verification gate + durable ceiling vs a queued note

- **Unverified:** SAFE. The sweep **skips** an unverified rep (`note-sweep-service.ts:52`, mirrors the
  spend-cap skip) — no attempt bump, no `needs_review` — and `extractNote` also defers
  (`verification_required`). The note waits `pending_extraction` and extracts on verify. ✅
- **Over the spend cap:** SAFE. The sweep **skips** a capped rep (`note-sweep-service.ts:50`); note waits
  intact. ✅
- **⚠️ At the trial extraction CEILING: NOT SAFE — a real bug that this batch makes load-bearing.** The
  ceiling is enforced only *inside* `extractNote` (`limiter.allow` → returns `trial_limit`, leaves the
  note `pending_extraction`). The sweep has **no ceiling skip** — it calls `extract()`, which the wrapper
  runs as `extractNote(...).then(() => undefined)` (`index.ts:242`, outcome ignored). So the sweep bumps
  `sweepAttempts` each pass, the note never advances, and after **5 passes it is marked `needs_review`** —
  a ceiling-deferred note mislabeled as failed, then stuck (never re-extracted if the trial converts).
  Today this is masked because `/extract` is the primary path and the sweep is a fallback; **when the
  sweep becomes primary (this batch), every trial rep who hits the ceiling loses their remaining notes to
  `needs_review`.** Fixing this (a sweep-level ceiling skip, or a distinct `deferred` state that is not
  attempt-counted) is a **required part of Task 3**, not optional.

---

## Options for the sweep's capacity (report, NOT chosen — this is your decision)

Fairness across accounts matters more than raw throughput (your words), which rules out "just tick
faster."

| Option | What | Fairness | New infra? | Trade-off |
|---|---|---|---|---|
| **A. In-process bounded concurrency + per-rep round-robin + import chunking** | Process K notes concurrently (a `p-limit`), one note per rep per cycle so a book never starves a single note; split a large import into segments so it interleaves | Strong (round-robin) | None | Bounded by one container's CPU + the model rate limit; drain time ÷K; K must respect provider TPM/RPM |
| **B. Sharded sweep across containers** | Replace the single global lock with per-shard advisory locks (hash userId → shard); each container claims shards → fleet-parallel | Good (per shard) | None (uses existing autoscaling) | Scales with container count; needs care that shards rebalance as the fleet scales; still sequential within a shard unless combined with A |
| **C. Dedicated queue + worker fleet (SQS / BullMQ)** | A real job queue with N workers, ret/visibility timeouts, DLQ | Strong (per-message) | **Yes — new infra** | The textbook scalable answer; but new infrastructure (adjacent to the ALB/CloudFront work this batch put out of scope) |
| **D. Tick faster only** | Lower `tickMs`/`intervalMs` | None | None | Marginal — does not fix single-threaded, single-container throughput; rejected against the fairness goal |

**Recommendation direction (for your call):** **A** is the in-code lever that needs no new infra and
directly serves the fairness goal — bounded parallel extraction with per-rep round-robin and large-import
chunking. **B** stacks on top if one container's model-call throughput isn't enough for the pilot's
concurrency. **C** is the honest answer if this must scale well beyond the pilot, but it is new infra.

**I have not proceeded past Task 1.** Which capacity model (A / B / A+B / C) should Task 3 build — and do
you confirm the ceiling→`needs_review` bug (§6) is fixed as part of it?
