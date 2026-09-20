# docs/ change — AUTHORIZED to apply, but BLOCKED by the guard hook

The owner authorized applying this edit ("Doc edit: apply it"). I attempted it and the
`guard-protected-files.sh` PreToolUse hook **hard-blocked** the write to `docs/`:

> [guard] BLOCKED: docs/ holds locked product decisions … Do not invent or amend product decisions.

The hook can't distinguish an owner-authorized amendment from an unauthorized one, and I won't
route around a configured guard via a shell write. **To apply it, either:** (a) paste the change
below yourself, or (b) temporarily lift the guard hook and tell me to proceed. The exact text:

---

## 1. `docs/tovira-spec.md` §5g — replace the "Email verification is SOFT" paragraph

**Replace this (lines ~251-258):**

```
**Email verification is SOFT.** A rep has full access to every feature from the
moment they sign up; verification is NEVER a gate. On signup the welcome email
carries a single-use, hashed, 7-day confirmation link; until confirmed, a quiet
dismissible in-app banner invites confirmation with a server-rate-limited resend
(3 per user per UTC day). Rationale: deliverability of the commercially-critical
lifecycle emails matters, but capture-friction at first value matters more — so we
capture the address's validity without blocking the first chat. (Hard/gated
verification was considered and **rejected**.)
```

**With this:**

```
**Email verification is SOFT — for reading, browsing and capture.** A rep has full
access to read, browse, capture, export and delete from the moment they sign up;
verification is never a gate on those. **The one exception is extraction** — the single
operation that spends money on an external provider on demand. Extraction requires a
verified email: an unverified rep's captures are stored and **queue** unextracted
(nothing is lost), and they extract automatically the moment they verify. On signup the
welcome email carries a single-use, hashed, 7-day confirmation link; until confirmed, a
quiet dismissible in-app banner invites confirmation with a server-rate-limited resend
(3 per user per UTC day). Rationale: deliverability of the commercially-critical
lifecycle emails matters, and capture-friction at first value matters more — so we never
block capture — but "never gate access" was about reading and capture, never about an
unbounded-cost paid operation, and an ungated extraction lets an unverified account spend
real credits (trial farming). A blanket hard-gate on *all* access was considered and
**rejected**, and remains rejected; this gates *only* extraction.
```

## 2. `docs/tovira-spec.md` — append to the locked-decision log (near line ~329)

Add a dated amendment (don't rewrite the existing 2026-08-16 line):

```
- **2026-09-20** — Amended the SOFT-verification decision (§5g): verification now gates
  **extraction only** (the one paid, unbounded-cost operation). Reading, browsing, capture,
  export and delete stay open from signup; unverified captures queue and extract on verify.
  Also tightened trial cost defence — a trial-specific spend cap (AED 15, vs the AED 45
  paying-account failsafe), a durable monotonic extraction counter (trial ceiling 100 / paid
  2000 per period), and a normalised trial-grant key (plus-tags + Gmail dots). Rationale:
  trial farming confirmed in production (open signup + unverified extraction spends real
  credits). Blanket access-gating stays rejected.
```

## Note on scope
No other `docs/` sections reference the soft-verification rule. The extraction-prompt and gate
docs are untouched.
