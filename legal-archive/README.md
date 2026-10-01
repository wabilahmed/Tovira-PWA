# Legal document archive

Frozen copies of every published version of the Terms of Service and Privacy Policy, keyed by
version identifier. A stored acceptance record (`users.terms_version_accepted`,
`access_requests.confirmation_text_version`) points at one of these identifiers; this directory is
how that string resolves back to the **exact wording the person saw**. The version constants live in
`apps/api/src/services/legal/versions.ts`, and `versions.test.ts` fails the build if a published page
drifts from its constant.

## Contents

- `2026-09-22/` — the current **published** Terms and Privacy (owner-approved). This is the version new
  acceptances record (`TERMS_VERSION` / `PRIVACY_VERSION`). Snapshotted from `apps/web/{terms,privacy}/index.html`.
- `2026-08-01/` — recovered from git (commit `87f81e8`, the last commit before the pages were published).
  **These are DRAFTS**, stamped `Version 2026-08-01 · Draft` and marked lawyer-review-required; they were
  never owner-approved. They are archived because `CONSENT_POLICY_VERSION` was `'2026-08-01'` before the
  rename, so some accounts may hold `terms_version_accepted = '2026-08-01'`. This is the draft text those
  routes served at the time, preserved so that record still resolves to real wording — accurately labelled
  as a draft, not represented as a published version. Those stored values are NOT rewritten (BETA-2c).

## Taking a snapshot when the terms change (manual — do NOT automate the overwrite)

1. **Before** editing `apps/web/terms/index.html` or `apps/web/privacy/index.html`, copy the CURRENT
   published file into `legal-archive/<its current version>/` if it is not already archived. The outgoing
   text must be frozen first, or the version it is keyed to becomes unresolvable.
2. Edit the live page: update the visible `Last updated:` date, and the `data-doc-version="..."` attribute
   and its visible `· Version <id>` text, to the new identifier (`YYYY-MM-DD`, the date the wording changed).
3. Bump the matching constant in `apps/api/src/services/legal/versions.ts` to the same identifier.
4. Copy the new published file into `legal-archive/<new version>/`.
5. Run `npx vitest run apps/api/src/services/legal/versions.test.ts` — the reconcile guard must be green
   (the page's `data-doc-version` equals the constant).

The overwrite of the live page stays a deliberate human step: adding a version marker is not a revision,
but changing the text or the date asserts a revision, and that assertion must be made by a person.

## If a version's text is ever genuinely unrecoverable

If git does not contain a version that an acceptance record points at, do not leave a dangling reference:
create `legal-archive/<id>/UNRECOVERABLE.md` recording that the `<id>` text could not be recovered and
why. (Not needed today — every referenced version, `2026-09-22` and `2026-08-01`, was recovered above.)
