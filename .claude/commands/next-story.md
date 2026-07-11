---
description: Implement the next unimplemented user story, tests-first
---

Find and implement the next story from `docs/tovira-user-stories.md`.

## Steps
1. Check `git log --oneline` to see which story IDs are already committed.
2. Pick the **next unimplemented story in phase order** (P0 → P1 → P2 → …).
   If the user named a story ($ARGUMENTS), use that one instead.
3. Read that story's acceptance criteria and its **positive AND negative tests**
   in `docs/tovira-acceptance-tests.md`.
4. **Write the tests first.** All of them, including every negative test.
   Run them — they must FAIL. (If they pass before you've written any code,
   the tests are wrong. Stop and say so.)
5. Implement until every test passes.
6. Run the FULL suite. No regressions.
7. Typecheck + lint clean.
8. Commit: `feat(<STORY-ID>): <story title>`
9. Report what you built, what you tested, and anything ambiguous. Then STOP.

## Hard rules
- NEVER modify a test to make it pass.
- NEVER skip the negative tests — they encode the product's trust rules.
- NEVER invent a product decision. If the spec is silent, append the question to
  `BLOCKERS.md` and stop.
