# BLOCKERS

None open.

## Resolved

- **Load-induced test-suite timing flakes** — `password.test.ts` `[LOGIN-TIMING]`,
  `share-referral.test.ts`, and `inventory-share.test.ts` intermittently failed the verify-on-stop full
  run under CPU contention (inflated wall-clock measurements; a starved scrypt signup returning a
  non-JSON body). **Fixed** by a sequential timing pool: those three files are excluded from the
  parallel `vitest.config.ts` and run alone, `fileParallelism: false`, in `vitest.timing.config.ts`,
  which `npm test` runs immediately after the main suite (so they still gate — locally and in CI, which
  invokes `npm test`). No assertion or timeout was changed; the timing tests' teeth were re-proven by
  mutation. See the `TIMING-POOL` commit.

---

## redaction-ingest.test.ts — "4539" substring flake (false-positive-prone assertion)

**Status:** pre-existing, intermittent. NOT caused by the bulk-import / RULING 2 batch (that batch
touches none of the redaction, extraction-log, or id-generation path). Surfaced once during a
verify-on-stop run; passes 5/5 on re-run with fresh ids.

**The test** (`[REDACT-2/4] … the log never contains them`, redaction-ingest.test.ts:57) asserts the
card's leading digits are absent from the WHOLE serialized extraction-log row:
`expect(JSON.stringify(logRow)).not.toContain('4539')`. That row includes a randomly generated hex
`noteId` UUID. "4539" is four hex chars, so a UUID contains it by chance ~0.04% of the time
(≈29 overlapping 4-grams / 65536). The failing run's id was
`ded3ce86-7bf4-40ba-9081-1fff24539af1` — the match is the UUID's `…1fff2`**`4539`**`af1`, NOT the card.
The same risk applies to the `'0343'` IBAN-prefix assertion on the next line.

The redaction itself is working — the card/IBAN values are genuinely absent from the log; only the
coincidental UUID substring trips the blanket `toContain`.

**Why not "fixed" here:** per the batch rules I do not modify a test I did not author to get an
unrelated build green, and weakening it is forbidden. Left for the owner.

**Suggested fix (owner):** scope the assertion to the fields that could carry note content rather than
the whole blob+id — e.g. assert over `rawText` / the message bodies / the stored note, not the random
`noteId`/`id`/`userId` UUIDs; or strip the id fields before the `toContain` check; or use a fixed,
UUID-free test id. No change to what the test guards (Tier-1 values never reach storage or the log),
only to the over-broad substring surface.
