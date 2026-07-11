# (template — copy per phase)

Implement Phase <N> of `docs/tovira-dev-plan.md`: stories <IDs>.

For EACH story, in order:
1. Read its acceptance criteria + positive/negative tests in
   `docs/tovira-acceptance-tests.md`
2. Write the tests first — they must fail
3. Implement until green
4. Run the FULL suite — no regressions
5. Commit with the story ID
6. Move to the next story

Rules:
- Never modify a test to make it pass.
- If the spec is ambiguous, STOP and append the question to BLOCKERS.md
  instead of guessing.
- Do not start a new story while the suite is red.
- Local only. No AWS, no Terraform, no Stripe live keys.

When all stories are done, write `PHASE-<N>-REPORT.md`: what was built, tests
added, anything flagged in BLOCKERS.md, and what a human should review.
