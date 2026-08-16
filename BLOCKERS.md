# Blockers & Open Questions

*The agent writes here instead of guessing. A human answers, then the agent continues.*

Format:
- **[STORY-ID]** Question. — *(status: open / answered / resolved)*

---

## Open — needs a human (not resolvable by a coding agent)

*None.*

---

## Resolved (kept for the audit trail)

- **[SYNC / extraction prompt version]** RESOLVED-BY-SYNC. Earlier notes worried
  the prompt was labelled v0.1/v0.2; the canonical doc superseded that. The repo
  copy `docs/tovira-extraction-prompt.md` is already **v0.5** (title + version
  string `tovira-extract-v0.5`), reflecting the ladder v0.2 (added
  `unanswered_questions` to the model contract) → v0.3 (withdrew it — the
  deterministic-in-code implementation was the better design, so the doc followed
  the code) → v0.4 (year-less-date rule after the gate failure) → v0.5
  (no-null-named-person rule). The certified engine (3 clean runs) is v0.5. No
  labelling decision remains.

Everything below was open at some point and is now **shipped + tested** — nothing
here is still actionable by a coding agent.

- **[EMAIL / 1d — email verification]** RESOLVED via **soft verification**
  (`feat(EMAIL-VERIFY)`), exactly the recommended option (b): full access from
  signup, a quiet dismissible "Confirm your email" banner with a server-rate-
  limited Resend, single-use hashed 7-day tokens, verified state in Settings.
- **[EMAIL / 1c — lifecycle email wiring]** RESOLVED via `feat(EMAIL-HOOKS)`:
  payment-failed / subscription-confirmed / canceled fire from the Stripe webhook
  (idempotent per Stripe event id); account-deleted sends **before** the purge;
  trial-ending (~2 days out) + trial-ended run from the `trial-emails` scheduled
  job (idempotent per (user, event), extension-aware). A failing send never breaks
  the business action.
- **[FLOWS / Card scan discards title + email]** RESOLVED (FLOWS-9): `CardScan`
  passes scanned title/email as `extras` to `POST /clients`; tested.
- **[FLOWS / Duplicate re-import shows "Import failed."]** RESOLVED:
  `clientsClient.importWhatsApp` reads the `duplicate` flag and returns
  `{ ok: true, duplicate: true }` for a 200 no-op; tested.
- **[FLOWS / Meetings parse contract mismatch]** RESOLVED: `meetingsClient.parse`
  returns the discriminated `ParseResult`, and `Meetings.tsx` branches on `kind`
  (`proposal` / `ambiguous_time` / `ambiguous_client` candidates / `no_client`).
- **[FLOWS / Voice pipeline can stall at pending_transcription]** RESOLVED
  (FLOWS-7): the `note-sweep-service` + the `notes-sweep` scheduled job advance
  stuck notes server-side with bounded retries → terminal `needs_review`, so a
  note is never lost even if the rep never revisits the screen.
- **[FLOWS / Android share-target has no handler]** RESOLVED: `apps/web/src/pwa/sw.ts`
  intercepts the `POST /share-target`, reads the export via `readSharedChat`, and
  stashes it in IndexedDB; the app consumes it on next load (`consumeSharedChat`).
  (Live delivery is still device-only to exercise — see the manual-test checklist.)
- **[SYNC / docs(SYNC) — PROJECT-STATUS in docs/]** RESOLVED earlier: the status
  doc now lives at the repo root (`PROJECT-STATUS.md`, agent-owned) and is kept
  current; the guard-protected `docs/` copy is no longer the source of truth.
