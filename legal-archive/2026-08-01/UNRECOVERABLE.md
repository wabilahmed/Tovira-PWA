# Version 2026-08-01 — published text UNRECOVERABLE (never existed)

An account may hold `terms_version_accepted = '2026-08-01'` (the value of the former
`CONSENT_POLICY_VERSION` before the BETA-2a rename). **There is no published Terms/Privacy text
for this version**, and none can be recovered, because the pages were never published at version
`2026-08-01`:

- The Terms and Privacy pages (`apps/web/{terms,privacy}/index.html`) were **first published** at
  version **`2026-09-22`** (see `../2026-09-22/`).
- Before that, the only artifact bearing `Version 2026-08-01` in git is a **pre-publication
  lawyer-review skeleton** (commit `87f81e8`, committed **2026-09-22**), stamped
  `Version 2026-08-01 · Draft` and carrying `LAWYER REVIEW REQUIRED — this is a structured
  skeleton, not final legal text` on every section. It was never owner-approved and is not a
  document any user accepted as terms. (`legal.test.ts` enforces that the *published* pages contain
  no such marker — confirming the skeleton was never the live text.)

An earlier BETA-2c attempt archived that skeleton here as `terms.html` / `privacy.html`. That was
wrong: a dated archive entry holding skeleton text looks like evidence of what a user accepted, and
it is not. The files were removed; this record replaces them (verified at the reviewer's request).

**How to treat a stored `2026-08-01` acceptance:** as an acceptance whose exact shown wording cannot
be produced. Do not substitute the `2026-09-22` text or the skeleton for it. If any such account
exists and the exact wording is ever needed (e.g. a regulator request), it must be reconstructed from
deploy history / whatever the app actually served at signup time, not from this repository.
