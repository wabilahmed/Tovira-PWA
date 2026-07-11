# Tovira — Agent Instructions

## What this is
An AI memory bank for **field salespeople**. It captures voice notes and pasted
messages about clients, extracts structured facts, and surfaces them before the
next meeting.

Full context lives in `docs/`. **Read `docs/tovira-spec.md` before any
non-trivial work.** Decisions there are LOCKED — do not re-litigate them.

## Non-negotiable workflow (every story, no exceptions)
1. Pick ONE story from `docs/tovira-user-stories.md`.
2. Read its acceptance criteria + **positive and negative tests** in
   `docs/tovira-acceptance-tests.md`.
3. **Write the tests FIRST**, including every negative test. Run them — they
   must FAIL. (If they pass before you write code, the tests are wrong: stop.)
4. Implement until green. **Never modify a test to make it pass.**
5. Run the FULL suite. No regressions.
6. Typecheck + lint clean.
7. Commit with the story ID: `feat(P1-6): extract structured facts`
8. Report: what was built, what was tested, anything ambiguous. Then STOP.

## Hard rules (violating these = failed work)
- **NEVER** weaken, skip, or delete a test to get it green. If a test seems
  wrong, STOP and write it to `BLOCKERS.md` — do not "fix" it.
- **NEVER** mark a story done with a red suite.
- **NEVER** invent a product decision. If the spec is silent → `BLOCKERS.md`, stop.
- **NEVER** skip the negative tests. They ARE the product's trust rules.
- **NEVER** touch AWS, Terraform, or Stripe live keys. Phases 0–5 are LOCAL ONLY.
- **NEVER** commit secrets. Use `.env` + `.env.example`.

## Product principles (these override convenience)
- **A wrong fact is worse than a missing one.** Extraction must never fabricate a
  promise, guess a date, or merge two people. When unsure → flag, don't guess.
- **The server is the source of truth; the phone is a window.** Nothing important
  lives only on the device. Never lose a recording.
- **Tenant isolation is enforced at the DB (Postgres RLS)**, not just in app code.
- **Capture friction kills the product.** Protect the speed of the capture path.
- **Never present an unconfirmed guess as a fact.**
- **Prompt caching:** the cacheable prefix must be byte-identical every call.
  Today's date and client names go in the VARIABLE part, never the cached prefix.

## Stack (locked — do not re-litigate)
TypeScript end-to-end · React PWA (Vite) · Node API · PostgreSQL + pgvector ·
Docker Compose locally · Vitest + Playwright · Claude via an interface (Anthropic
API locally → Bedrock in prod) · Groq for STT · Stripe **test mode only**.

## Commands
- `docker compose up` — full local stack
- `npm run dev` · `npm test` · `npm run test:e2e`
- `npm run typecheck` · `npm run lint`

## Definition of done (ALL must be true)
- [ ] All positive AND negative tests from the acceptance doc pass
- [ ] Full suite green — no regressions
- [ ] Typecheck + lint clean
- [ ] No secrets, no cloud calls, no spend
- [ ] Committed with the story ID
