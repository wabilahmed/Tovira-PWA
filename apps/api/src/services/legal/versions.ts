/**
 * [BETA-2c] The single source of truth for legal-document versions. Every stored acceptance record
 * points at one of these identifiers, and the reconcile guard (versions.test.ts) fails the build if a
 * published page's rendered version drifts from the constant here — so an acceptance can always be
 * resolved to the exact wording the person saw (see legal-archive/ for the frozen text of each version).
 *
 * Identifiers are date-based ISO (YYYY-MM-DD) = the date that document's wording last changed. Bump a
 * constant ONLY when its document actually changes, and snapshot the outgoing text into legal-archive/
 * first (see legal-archive/README.md). This supersedes the former auth-service CONSENT_POLICY_VERSION —
 * one source of truth, not three.
 */

/** Terms of Service version. Derivation: matches "Last updated: 3 October 2026" on the published Terms
 *  page (apps/web/terms/index.html) — the last time the Terms wording changed (the 2026-10-03 revision
 *  added clause 6.9, the usage-allowance + top-ups wording, for the monthly AI allowance batch). The
 *  reconcile guard proves the page and this constant agree. Prior published versions are archived under
 *  legal-archive/2026-10-02/ (voice-note clause 4.10) and legal-archive/2026-09-22/ (first published). */
export const TERMS_VERSION = '2026-10-03';

/** Privacy Policy version. Derivation: matches "Last updated: 2 October 2026" on the published Privacy
 *  page (apps/web/privacy/index.html) — the 2026-10-02 revision corrected the voice redaction claim,
 *  added the recording-retention and access-request disclosures, and the image-storage statement.
 *  Tracked separately from TERMS so the two can diverge when only one document changes; today they are
 *  the same date. Prior published version: legal-archive/2026-09-22/. */
export const PRIVACY_VERSION = '2026-10-02';

/** Version of the access-request confirmation checkbox wording (BETA-3). Derivation: the date that
 *  exact confirmation sentence was fixed — authored in this batch, 2026-10-01. It is NOT terms
 *  acceptance; it is stored against access_requests.confirmation_text_version so we can later prove
 *  which wording a submitter was shown. Bump only if the confirmation sentence itself changes. */
export const CONFIRMATION_TEXT_VERSION = '2026-10-01';
