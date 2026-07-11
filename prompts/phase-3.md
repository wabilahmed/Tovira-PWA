Implement Phase 3 of `docs/tovira-dev-plan.md`: stories P3-1 through P3-6.

The proactive layer: internal calendar (incl. natural-language meeting entry via
the extraction engine), a LOCAL cron/script standing in for EventBridge+Lambda
that runs the daily going-cold / upcoming-meeting / date-reminder scan, Web Push
(VAPID), and the in-app cold-clients fallback list.

For EACH story: tests first (positive AND negative), implement, full suite green,
commit with the story ID.

Critical for this phase:
- The scheduled scan MUST be **idempotent** — re-running it the same day must not
  re-fire an already-sent alert. There is a negative test for this.
- Build the **in-app fallback** properly. Assume push never arrives; iOS push is
  unreliable and cannot be verified locally at all.
- Natural-language meeting parsing must ASK when ambiguous (two clients named
  Sarah; "sometime next week") — never silently pick.

Note: real iOS push delivery CANNOT be tested locally. Build it, test what you
can, and note in the report that P6-3 (real-device verification) remains open.

Rules: never modify a test to pass; ambiguity → BLOCKERS.md; local only.
When done, write `PHASE-3-REPORT.md`.
