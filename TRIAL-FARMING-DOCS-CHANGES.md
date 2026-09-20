# Proposed docs/ changes (LISTED, not applied — docs/ is guard-protected)

Task 2 reverses one narrow aspect of a **locked** decision. The change below is proposed for
your review; I have **not** edited `docs/`.

## `docs/tovira-spec.md:251-258` — the "Email verification is SOFT" paragraph

**Current (locked):**
> **Email verification is SOFT.** A rep has full access to every feature from the
> moment they sign up; verification is NEVER a gate. On signup the welcome email
> [...] (hard/gated verification was considered and **rejected**.)

**Proposed replacement (the rule is unchanged except for paid external operations):**
> **Email verification is SOFT — for reading, browsing and capture.** A rep has full access to
> read, browse, capture, export and delete from the moment they sign up; verification is never a
> gate on those. **The one exception is extraction** — the single operation that spends money on an
> external provider on demand. Extraction requires a verified email: an unverified rep's captures
> are stored and **queue** unextracted (nothing is lost), and they extract automatically the moment
> they verify. This is the doctrine's actual intent — "never gate access" was about reading and
> capture, never about an unbounded-cost paid operation. (A blanket hard-gate on *all* access was
> considered and rejected, and remains rejected; this gates *only* extraction.)

## `docs/tovira-spec.md:329` — the 2026-08-16 locked-decision log line

Append a dated amendment (do not rewrite history):
> **2026-09-20** — Amended the SOFT-verification decision (§5g): verification now gates **extraction
> only** (the one paid, unbounded-cost operation). Reading, browsing, capture, export and delete stay
> open from signup; unverified captures queue and extract on verify. Rationale: closing trial-farming
> exposure confirmed in production (open signup + unverified extraction spends real credits). Blanket
> access-gating stays rejected.

## Note on scope
No other `docs/` sections reference the soft-verification rule (grep of `docs/` for
verification / "never gate"). The extraction-prompt and gate docs are untouched.
