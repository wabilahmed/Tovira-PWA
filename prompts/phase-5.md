Implement Phase 5 of `docs/tovira-dev-plan.md`: stories P5-1 through P5-4.

Monetization & launch readiness: Stripe subscription + 7-day trial (**TEST MODE
ONLY** — sk_test_ keys), day-one seeding onboarding, consent/retention/export/
delete, and logic-level hardening.

For EACH story: tests first (positive AND negative), implement, full suite green,
commit with the story ID.

The critical rule for this phase — there is a negative test for it:
**Stripe WEBHOOKS are the source of truth for subscription state, never the
client.** Hitting the success-redirect URL without a corresponding webhook must
NOT mark the account as paid. Webhooks must be idempotent (replayed events don't
double-provision) and signature-verified (invalid signature → rejected).

Also: the seeding onboarding exists because Tovira's value compounds and the
7-day trial may end before the rep hits the "aha". Make first-value fast.

Rules: never modify a test to pass; ambiguity → BLOCKERS.md; **Stripe test mode
only — never live keys**; no AWS.
When done, write `PHASE-5-REPORT.md`.
