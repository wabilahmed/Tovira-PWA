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

/** Terms of Service version. [P71-L · owner] 2026-11-17 added the lawyer-approved section "9. AI-generated information",
 *  word for word, straight after section 8; the old sections 9 to 15 became 10 to 16, with the cross-references inside
 *  the Terms that point at them. Nothing else changed (prior published version: legal-archive/2026-10-21/). A bump asks
 *  no one to re-accept: the version is only recorded when someone accepts.
 *  Earlier derivation: matches "Last updated: 21 October 2026" on the published Terms
 *  page (apps/web/terms/index.html) — the last time the Terms wording changed (the 2026-10-21 revision, P38,
 *  removed the unnumbered top-up paragraph under 6.9 that contradicted 6.10 on refunds; 2026-10-20 added 6.10).
 *  The reconcile guard proves the page and this constant agree. Prior published versions are archived under
 *  legal-archive/ (2026-10-20, 2026-10-05, 2026-10-03, 2026-10-02, 2026-09-22). PRIVACY_VERSION is unchanged. */
export const TERMS_VERSION = '2026-11-17';

/** Privacy Policy version. [P75 · owner] 2026-11-18 added the lawyer-approved WhatsApp line, word for word, straight
 *  after the anonymous statistics lines ("…We count anonymous game interactions to improve the page."): "When you
 *  request beta access, we ask for your WhatsApp number. …" Nothing else changed (prior published version:
 *  legal-archive/2026-11-16/). A bump asks no one to re-accept: the version is only recorded when someone accepts.
 *  [P71-T · owner] 2026-11-16 added the lawyer-approved line straight after "We keep anonymous
 *  statistics about how the product is used.": "We count anonymous game interactions to improve the page." Nothing else
 *  changed (prior published version: legal-archive/2026-10-27/). A bump asks no one to re-accept: the version is only
 *  recorded when someone accepts.
 *  [P48] 2026-10-27 added the lawyer-approved line in section 13: a restricted person may be
 *  held back from the rep's copy during a review (prior published version: legal-archive/2026-10-05/).
 *  Earlier derivation: matches "Last updated: 2 October 2026" on the published Privacy
 *  page (apps/web/privacy/index.html) — the 2026-10-02 revision corrected the voice redaction claim,
 *  added the recording-retention and access-request disclosures, and the image-storage statement.
 *  Tracked separately from TERMS so the two can diverge when only one document changes; today they are
 *  the same date. Prior published version: legal-archive/2026-09-22/. */
export const PRIVACY_VERSION = '2026-11-18';

/** Version of the access-request confirmation checkbox wording (BETA-3). Derivation: the date that
 *  exact confirmation sentence was fixed — authored in this batch, 2026-10-01. It is NOT terms
 *  acceptance; it is stored against access_requests.confirmation_text_version so we can later prove
 *  which wording a submitter was shown. Bump only if the confirmation sentence itself changes. */
export const CONFIRMATION_TEXT_VERSION = '2026-10-01';
