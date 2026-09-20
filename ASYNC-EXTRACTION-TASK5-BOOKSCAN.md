# Async extraction — Task 5: the Book Scan (options only — NOT picked)

The Book Scan runs on import and is the trial's wow moment. With extraction async, an import's
findings now land over seconds as the sweep drains, so the once-on-mount fetch (which never re-fetches)
is no longer right. Three options, with trade-offs. **Not chosen — your call.**

Groundwork already in place (Task 4): the client-notes response carries per-note `extractionState` and
an `extraction` aggregate ({queued, processing, done, failed, total}), and the app already polls while
work is in progress. So options 2 and 3 are cheap to build on what exists; the Book Scan itself was
deliberately left unchanged pending this decision.

## Option 1 — WAIT for the import to finish, then reveal
Hold the Book Scan on a "reading your history…" state until the import's notes are all terminal
(done/failed), then run the one orchestrated deal-out reveal, complete.
- **For:** the designed wow — a single, dramatic, complete reveal — lands intact; no empty/partial
  flash; findings appear in the intended order with the deal-out animation.
- **Against:** the rep stares at a spinner for the whole drain (10–30s+ for a real book, and worst
  precisely at the high-concurrency day-one moment this batch exists to fix); needs a hard rule that a
  FAILED note doesn't stall "all done" forever; a slow last chat delays the entire reveal.

## Option 2 — STREAM findings in as they land
Poll and append findings incrementally as each chat extracts.
- **For:** immediate life and momentum; no long blank wait; naturally resilient (shows whatever is
  ready, a failure just never contributes its finding).
- **Against:** the single orchestrated reveal is lost — findings pop in piecemeal, which reads as less
  intentional than the deal-out; ordering/animation across late arrivals is harder to keep elegant; a
  finding appearing after the "reveal" can feel like a glitch rather than a moment.

## Option 3 — PARTIAL results immediately, with progress
Render whatever is extracted right now plus an honest progress line ("still analysing 3 of 8 chats…",
straight from the Task 4 aggregate), settling as the rest land.
- **For:** honest and immediate — the rep sees real findings fast and knows more are coming; reuses the
  aggregate + polling already built; degrades gracefully; the progress line turns the wait into
  reassurance instead of a dead spinner.
- **Against:** the first paint can be thin or empty if nothing has extracted yet, so it needs a strong
  "working…" empty-but-alive state; the experience becomes a "fill-in" rather than one reveal moment —
  the deal-out drama is softened.

## The core tension
The wow moment was designed as a **single orchestrated reveal** (Option 1 preserves it, at the cost of a
spinner exactly when concurrency is worst). Options 2 and 3 trade that single-moment drama for immediacy
and resilience, and fit the async grain + the Task 4 groundwork more naturally. Whichever is chosen,
**a FAILED note must be handled** (it must not stall a "wait", and should be surfaced, not hidden).

**Not implemented. Awaiting your decision on which behaviour the Book Scan should take.**
