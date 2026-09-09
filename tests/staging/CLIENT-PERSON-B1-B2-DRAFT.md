# B1 + B2 — client-as-person (DRAFT — stop for review before applying)

Nothing below is applied yet. B1 is the prompt rule draft; B2 is the complete changed-fixture list.

---

## B1 — the rule (prompt v0.9.3 → v0.9.4)

**Extend Rule 6** (currently: *"The note is about the client named in the message below. Attribute
facts to the right person; the main contact may be that client, but notes can mention others."*) with:

> When that client is a **named individual** (a person, not an organization), they **are** a
> stakeholder: include them in `people` under their **real client name** — never a chat alias or
> nickname — with `decision_role` set by the same rule as everyone else (Rule 5): **`unknown` unless
> the note states their authority.** Being the client does not imply they decide — they may be a
> coordinator whose manager signs off. When the client is an **organization** (a company, group, or
> account), it is **not** a person: do not invent a human for it — list only the named individuals
> actually mentioned.

**New worked example (the Example D precedent — examples move this model harder than rules):**

> ### Example I — the client is a named person with no other stakeholders
> clientName: `Omar Al Mansouri` · note: *"Quick call with Omar. He wants the revised quote by
> Thursday, said he'll take it to their board."*
> → `people: [{"name":"Omar Al Mansouri","role":null,"reports_to":null,"decision_role":"unknown","notes":"Client"}]`
> Note: Omar is the client AND a person — he appears in `people`. `decision_role` is `unknown`: he
> takes it to the board, so his own authority isn't stated.

**Two conditions (both folded into the wording above):**
1. **Real client name, never the alias** — Imtinan Qureshi, not Bubu DXB. The client name passed in the
   context is already the normalised real name (import confirms the counterpart before extraction and
   learns the alias — alias-parse), so "use the client's own name as given" satisfies this; I'll also
   add a fixture asserting the alias case.
2. **`decision_role` unknown unless stated** — unchanged Rule-5 behavior; being the client grants no role.

`PROMPT_VERSION` → `tovira-extract-v0.9.4`.

---

## B2 — every fixture whose expected output this ruling changes

### A. Existing eval-set fixtures (person-client, currently `people: []` → must now include the client)
All gain one person entry: the client, `decision_role: unknown` (none state their own authority).

| fixture | client | change |
|---|---|---|
| `req-client-question` | Ahmed | add person Ahmed, unknown |
| `req-conditional` | Fatima | add person Fatima, unknown |
| `req-beside-tier1` | Ravi | add person Ravi, unknown |
| `req-past-purchase-not-requirement` | Rashid | add person Rashid, unknown **— fixes a cert people-fp** |
| `req-third-party-referral` | Omar (eval-set) | add person Omar, unknown |
| `req-on-behalf-of` | Layla | add person Layla, unknown **— fixes a cert people-fp** |
| `req-actor-split` | Faisal | add person Faisal, unknown **— fixes a cert people-fp** |

**This explains the cert's people-precision dip (p≈0.87–0.90):** the engine already emitted Rashid /
Layla / Faisal as people, scored as false positives because the fixtures expected `[]`. The ruling
aligns the fixtures with the engine's (now-sanctioned) behavior — people precision should **rise**.

### B. One ambiguous case — needs your call
| fixture | client | question |
|---|---|---|
| `req-rep-speculation` | **Nassar Family** | A *family* — person or account? The rule says an organization/group is an account (no person). "The Nassar family" reads as a group, so my default is **no change** (stays `people: []`). Overrule if a named family should seed a person. |

### C. Existing fixtures that do NOT change (confirming the company/person split holds)
Company clients stay as-is — the ruling does not force an org into `people`: Acme, Northwind, Halcyon,
Meridian, Vertex, Delta, Aldar, Wipro, Habib Bank, etc. `hindi-english-resolvable` (Rajesh Textiles)
already lists the contact "Rajesh" and is unchanged.

### D. Import fixtures (from this batch)
| fixture | change |
|---|---|
| `import-easy-omar` (full) | Omar Al Mansouri `decision_maker` → **`unknown`** (authority not stated — Rahman signs off). Plus the two corrections you named: **add the client-side promise** `{text:"Follow up after Eid", owner:"client", due_date:null, due_raw:"after Eid"}` (Omar's own "I'll follow up properly after Eid"), and **signed-MSA `due_date` 2024-06-12 → `null`** (the engine correctly declines to guess a year-less "the 12th" — the v0.4 rule; my expected over-asserted). Reminder: `owner:client` coverage — this adds a commitment the rep is *owed*, complementing Example H. |
| `import-medium-farah` (invariant) | Farah Haddad `decision_maker` → **`unknown`**; Reem `influencer` → **`unknown`** ("just coordinates" → unknown is correct). |
| `import-hard-imtinan` (invariant) | Imtinan Qureshi `decision_maker` → **`unknown`** (Bilal signs off by 2023). Plus **anchor match-string robustness** (from IMPORT-DIAG, so the scorer matches the engine's real phrasing): `"hold that price"`→`"hold the"`, `"renewal before the 30th"`→`"renewal"`, `"circle back after the summer"`→`"circle back"`; key-date anchors `"contract"/2020`→`"signed"/2020`, keep `"renewal"/2023`. |

### E. owner:client coverage (your check)
Existing coverage: Example H (`Circle back on the contract`, owner:client) in the prompt, and eval-set
carries client-owed promises. The import-easy-omar client follow-up adds another. **Confirmed covered**;
if you want a dedicated eval-set fixture for a rep-is-owed commitment, I'll add one.

---

**On your go I apply A + D, bump to v0.9.4, add Example I + the alias fixture + the four B2 new
client-person fixtures, then run B3 (full 3-run + import fixtures, every metric beside its previous
value, per-run cost). Awaiting your ruling on Nassar Family and any edits to the rule wording.**
