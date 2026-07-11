Implement Phase 0 of `docs/tovira-dev-plan.md`: stories P0-1 through P0-6.

This is the local foundation: Docker Compose (Postgres+pgvector, backend, web),
TypeScript API skeleton, React PWA (Vite) with service worker, local auth stub,
`user_id` on every table with **Postgres Row-Level Security ON**, and seed data.

For EACH story, in order:
1. Read its acceptance criteria + positive/negative tests in
   `docs/tovira-acceptance-tests.md`
2. Write the tests first — they must fail
3. Implement until green
4. Run the FULL suite — no regressions
5. Commit with the story ID

Pay special attention to **P0-2 (swap-ready interfaces)** and **P0-4 (tenant
isolation)**:
- Every external dependency (auth, model calls, storage, scheduler) MUST sit
  behind a thin interface with a local implementation. Business logic must never
  import a vendor SDK directly. Add an architecture test that fails if it does.
- The isolation negative tests are the point: prove RLS blocks cross-tenant reads
  even with the app-layer filter removed.

Rules:
- Never modify a test to make it pass.
- If the spec is ambiguous, STOP and append to BLOCKERS.md.
- Local only. No AWS, no Terraform, no Stripe.

When done, write `PHASE-0-REPORT.md`.
