Implement Phase 4 of `docs/tovira-dev-plan.md`: stories P4-1 through P4-6.

Feature completion: open promises tracker, stakeholder map, personal-facts memory,
follow-up draft generator, business-card scan, client gallery.

These all READ from the extraction spine built in Phase 1. **Do not build
per-feature extraction logic** — reuse the engine. Features stay thin.

For EACH story: tests first (positive AND negative), implement, full suite green,
commit with the story ID.

Watch for:
- P4-1: a promise with a null due date must show as "no date" — NOT sorted as if
  due today.
- P4-2: never merge two distinct people; unknown role = "unknown", never invented.
- P4-4: the follow-up draft must never state a commitment the rep didn't make, and
  must never auto-send.
- P4-5: a blurry card leaves fields BLANK — it never guesses.

Rules: never modify a test to pass; ambiguity → BLOCKERS.md; local only.
When done, write `PHASE-4-REPORT.md`.
