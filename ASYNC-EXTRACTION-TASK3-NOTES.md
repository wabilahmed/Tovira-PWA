# Async extraction — Task 3: the sweep is now the primary processor

Option A (in-process bounded concurrency + per-rep round-robin), with the ceiling bug fixed first.
Fairness across accounts was the priority, over raw throughput.

## The ceiling→needs_review bug — fixed FIRST
A note deferred at the trial/paid extraction ceiling is now **skipped by the sweep** exactly like a
spend-capped or unverified rep: its queue is left untouched — **no attempt bump, never `needs_review`**
— and resumes intact when the ceiling lifts (next billing period, or on subscribe). Added
`allow?(userId)` to `NoteSweepDeps` (wired to `extractionLimiter.allow` in `index.ts`), alongside the
existing `canSpend` / `isVerified` skips. Before this, a ceiling-deferred note was re-swept until it hit
`maxAttempts` and was mislabeled `needs_review`, losing a trial rep their book at the moment they judge
the product. (`note-sweep-service.ts`; unit-tested: skip + no attempt bump + resume.)

## What changed in the sweep

- **Ordering — round-robin fairness.** Eligible notes are interleaved one-per-rep-per-column
  (`[u0n0, u1n0, u2n0, u0n1, …]`) before draining. A rep's single note sits in column 0 and starts in
  the first cycle, so **one rep's big book never starves another rep's single note** — the priority you
  set. (Unit-tested: `['a0','b0','a1','a2']` — the small note `b0` is 2nd, not last.)
- **Batching — bounded concurrency.** A pool of `SWEEP_CONCURRENCY` (default **5**) workers drains the
  interleaved queue, so the sweep is no longer strictly serial. The shared cursor (`queue[cursor++]`,
  atomic on the single JS thread) hands each note to exactly one worker → **idempotent within a pass**
  (unit-tested: each note extracted exactly once under concurrency 4; max-in-flight is exactly 3 at
  concurrency 3 — concurrent, never unbounded). Across passes, a terminal note is never re-listed, so a
  note is never extracted twice.
- **Frequency.** The ScheduledBrain tick dropped **30s → 15s** so the notes-sweep (15s interval) fires
  on time; first-finding latency is ~15s rather than up to 30s. Other jobs have long intervals, so the
  faster due-check is negligible overhead.
- **Skips applied once, up front.** `canSpend` / `isVerified` / `allow` drop a whole rep's queue before
  interleaving (a skipped rep's notes are never touched, never attempt-counted).

## Chunking — a deliberate NO (with rationale)
"Whether a large import is chunked so one rep's 5,000-message import does not starve another's single
note": **not chunked, and fairness is still met.** Reasoning:
- A WhatsApp import is **one note per chat** (the extraction unit). A rep's book = many chats = many
  notes, so the queue is naturally many-noted and round-robin interleaves them across reps.
- Even a single large chat-note occupies **one** worker slot; the other `K-1` slots keep draining other
  reps' notes concurrently — so a big note does not block a small one (unit-tested: two accounts both
  progress in one pass; the small note is column 0).
- Splitting one chat's messages across separate model calls would **risk the trust doctrine**: a promise
  or context that spans messages could be lost or double-counted at a chunk boundary, and merging
  partial extractions is exactly the kind of fabrication risk the gate forbids. The chat is the unit
  that keeps a receipt honest.
- **If a single enormous chat ever dominates** at scale, the next lever is Option B (sharded locks →
  fleet-parallel) or C (a worker queue), not intra-note chunking. Flagged, not built (out of this
  batch's scope).

## Derivations (recorded, NOT settled)
- **`SWEEP_CONCURRENCY = 5`** — sized for the pilot's ~10 concurrent importers: a pool of 5 clears each
  fairness column of up to 10 reps in ~2 cycles, while staying well under the Bedrock per-model rate
  limit and one arm64 container's headroom (extraction is I/O-bound on the model call, not CPU). Higher
  risks provider 429s; lower reintroduces the day-one backlog. Revisit against real Bedrock TPM/RPM at
  pilot scale.
- **Tick 15s** — matches the sweep interval so the sweep is not artificially capped at 30s.

## Still single-container
The global advisory lock is unchanged, so exactly one container sweeps at a time — but now that
container drains concurrently and fairly. At ten reps this holds (§Task 1 capacity). Beyond the pilot,
sharded locks (B) or a worker queue (C) are the next step; the fairness + concurrency + chunking-decision
work here is needed regardless of which comes later.
