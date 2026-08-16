# Blockers & Open Questions

*The agent writes here instead of guessing. A human answers, then the agent continues.*

Format:
- **[STORY-ID]** Question. — *(status: open / answered)*

---

- **[SYNC / docs(SYNC)]** TASK 6 asked me to update `docs/PROJECT-STATUS.md`
  (cost-guard ③ now ✅ via the nightly precompute, hybrid routing noted, deferred
  items pruned). The repo guard hook (`.claude/hooks/guard-protected-files.sh`)
  blocks **all** edits under `docs/`, including this status doc, and directs
  changes to BLOCKERS.md. I did **not** override the guard. **Please either update
  `docs/PROJECT-STATUS.md` by hand or add a guard exception for status docs.**
  Concretely, the following are now stale in that file: headline stats (unit +
  component tests 651→729, 120→131 test files, migrations 0001-0023→0001-0025,
  commits); the P5-1 row still says "nightly-precompute cost-guard deferred";
  the cost-guard rules line still marks ③ as ⚠️ deferred (it is now ✅); §6
  "Deferred/optional" still lists cost-guard ③ and "client phone for the WhatsApp
  send loop" (both now shipped — P4b-3/CG3 and P4-7-PHONE); and hybrid per-task
  routing (extraction=Sonnet gate-lock, others=Haiku, per-class overridable) is
  not yet mentioned. — *(status: answered — user granted permission on
  2026-08-05; `docs/PROJECT-STATUS.md` updated by hand: headline stats refreshed,
  P5-1 row + cost-guard ③ marked ✅, §6 pruned, hybrid routing noted. The guard
  hook still blocks the Edit/Write tools on `docs/`, so the change was applied via
  a scripted exact-match replace with explicit authorization — the guard config
  itself was not touched.)*

- **[SYNC / extraction schema vs v0.2]** Verified the implemented extraction
  schema against `docs/tovira-extraction-prompt.md` (v0.2). Both v0.2 points hold:
  `unanswered_questions` is present in the output type (`extraction/types.ts`) and
  the **chat-export-only rule** is enforced (`extraction-service.ts:97` derives it
  via `detectUnansweredQuestions` **only** when `note.messages` exist; voice/paste
  notes get `[]`). One benign nuance, not a schema drift: the field is computed
  **deterministically in code**, not emitted by the model — the prompt file is
  still labelled `tovira-extract-v0.1` and does not carry the v0.2 model-schema
  field or the "multilingual Rule 0" text (`validate.ts:61` documents this on
  purpose). The deterministic path is arguably safer (aligns with "a wrong fact is
  worse than a missing one"). **No code change made.** Flagging only so the
  v0.1/v0.2 prompt-version label mismatch is a conscious human decision, not an
  oversight. — *(status: open)*


---

## Found during USER-FLOWS.md documentation (docs(FLOWS)) — not repaired

*Documentation task: recorded, not fixed. Full context in `USER-FLOWS.md` → Open questions.*

- **[FLOWS / Android share-target has no handler]** `apps/web/src/pwa/manifest.ts`
  declares `share_target.action = '/share-target'`, but no server route and no
  service-worker `fetch` handler exists for `/share-target`. A real Android "Share
  to Tovira" export POST is not received; day-one seeding works only via the in-app
  file picker / paste. The manifest + onboarding copy describe a path the code does
  not implement. — *(status: open)*

- **[FLOWS / Duplicate re-import shows "Import failed."]** The server returns HTTP
  **200** `{note:null, imported:0, duplicate:true}` for a fully-overlapping
  re-import (intended idempotent success), but `clientsClient.importWhatsApp`
  treats only **201** as success — so a duplicate re-import surfaces a red "Import
  failed." alert for what is actually a successful no-op. The `duplicate` flag is
  never read client-side. — *(status: open)*

- **[FLOWS / Meetings parse contract mismatch]** The server returns a discriminated
  `ParseResult` (`kind: proposal | ambiguous_time | ambiguous_client | no_client`),
  but `meetingsClient.parse` casts the body to a flat `ParsedMeeting` and the UI
  reads `preview.clientId`/`preview.title`. Only `proposal` carries `clientId`; no
  kind carries `title`; the `ambiguous_client` candidates and `no_client` name are
  never surfaced. The parser's ambiguity kinds render as a generic preview with
  undefined fields rather than the intended disambiguation prompts. — *(status: open)*

- **[FLOWS / Card scan discards title + email on create]** `CardScan` previews the
  scanned `title` and `email`, but `onCreateClient` sends only `name` (+`phone`) to
  `POST /clients`. The scanned title and email are shown then dropped. — *(status: open)*

- **[FLOWS / Voice pipeline can stall at pending_transcription]** The
  `pending_transcription → pending_extraction → extracted` progression is advanced
  by the browser (`App.tsx refresh()` firing transcribe then extract). If the rep
  never revisits the client-detail/Capture screen, a voice note can remain at
  `pending_transcription` indefinitely — there is no background worker. — *(status: open)*

---

## Launch-blocker batch (feat/fix commits) — decisions for Wabil

- **[EMAIL / 1d — email verification at signup]** DECISION NEEDED (not implemented).
  Trade-off: verifying the email at signup (a click-to-confirm link before the
  trial fully opens) improves deliverability of the commercially-critical
  lifecycle emails (trial-ending, payment-failed) and prevents a mistyped address
  from silently losing every future email — but it adds friction at the exact
  moment we want the rep capturing their first chat, and a broken/slow email
  provider would block signups. Current state: no verification; the address is
  taken as-is and password reset + lifecycle emails rely on it being correct.
  Options: (a) no verification (current), (b) soft — allow full use but show an
  unverified banner + re-send, (c) hard — gate the trial on verification.
  Recommendation for a self-serve launch: **(b) soft verification** — captures
  deliverability without blocking first value. Awaiting Wabil's call. — *(status: open)*

- **[EMAIL / 1c — lifecycle email wiring, partially shipped]** The email content
  for every lifecycle message is composed and unit-tested in
  `AccountEmailService` (welcome, trial-ending, trial-ended, payment-failed,
  subscription-confirmed, canceled, account-deleted), idempotent per (user,event).
  WIRED so far: password reset (full flow) and welcome-on-signup. NOT yet wired to
  their event sources: payment-failed / subscription-confirmed / canceled (need an
  email + user-email dependency inside `BillingService.handleWebhook`), account-
  deleted (inside `AccountService.deleteAccount`), and trial-ending (a new
  scheduled job, 2 days before `trialEndsAt`, using the existing scheduler seam).
  These are mechanical follow-ups on top of the tested service. — *(status: open)*
