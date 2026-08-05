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
  not yet mentioned. — *(status: open)*

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

