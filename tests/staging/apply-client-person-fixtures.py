#!/usr/bin/env python3
"""[CLIENT-PERSON] Reviewed script route for the human-CERTIFIED eval-set changes (v0.9.4).

The eval fixture is read-only to the Edit tools (guard-protected-files.sh) so the agent can't quietly
edit its own answer key; certified changes go through a reviewed script (the guard's own instruction).
Wabil certified this exact set (the B2 changed-fixture list). This script applies ONLY that set:
  A) 7 person-client fixtures gain the client in people (decision_role unknown — no authority stated).
  B) 3 new fixtures: client-with-stated-authority (decision_maker), client-under-alias (real name),
     org-client-negative (only the named individual, no invented person for the org).
Run: python3 tests/staging/apply-client-person-fixtures.py   (idempotent: refuses if already applied)
"""
import re, sys, pathlib

path = pathlib.Path('apps/api/src/eval/eval-set.ts')
src = path.read_text()

if 'client-person-org-negative' in src:
    print('already applied — no change'); sys.exit(0)

PERSON = lambda name, role, notes: (
    f"{{ name: '{name}', role: {role}, reports_to: null, decision_role: '{'decision_maker' if role=='DM' else 'unknown'}', notes: {notes} }}"
)

# ---- A) add the client to 7 person-client fixtures (unknown, notes null) ----
# key: unique summary-line substring -> client name to insert
ADD = {
    "Ahmed asked whether there is anything available with parking.": 'Ahmed',
    "Fatima said that, if the mortgage clears": 'Fatima',
    "Ravi is looking for a 1-bed in JLT for his son; he shared his Emirates ID": 'Ravi',
    "Rashid bought the JLT 1-bed shown last month": 'Rashid',
    "Quick call with Omar; he mentioned his colleague is looking": 'Omar',
    "Layla is looking for a 3-bed in Mirdif for her elderly parents": 'Layla',
    "Faisal is looking for a 2-bed in Downtown for himself": 'Faisal',
}
lines = src.split('\n')
out = []
for ln in lines:
    out.append(ln)
    for marker, client in ADD.items():
        if marker in ln and ln.strip().startswith('summary:'):
            indent = ln[:len(ln)-len(ln.lstrip())]
            out.append(f"{indent}people: [{{ name: '{client}', role: null, reports_to: null, decision_role: 'unknown', notes: null }}], // CLIENT-PERSON v0.9.4: client is a person; unknown (no authority stated)")
src = '\n'.join(out)

# ---- B) three new fixtures, inserted before the closing `];` of EVAL_NOTES ----
NEW = """  // ==== CLIENT-PERSON — the v0.9.4 client-as-person ruling, CERTIFIED by the owner 2026-09-09. ====
  // The client named in the context IS a person (real name, not a chat alias); decision_role unknown
  // unless the note states their authority; an ORGANIZATION client is an account, never a person.
  {
    id: 'client-person-authority', today: '2026-07-09', clientName: 'Yusuf', source: 'voice',
    note: 'Call with Yusuf. He said he signs off on this deal himself - no one else to clear it with.',
    expected: { ...empty,
      summary: 'Yusuf signs off on the deal himself, with no one else to clear it with.',
      people: [{ name: 'Yusuf', role: null, reports_to: null, decision_role: 'decision_maker', notes: 'Signs off on the deal himself' }],
    }, // client WITH stated authority -> decision_maker (the other half of the unknown-unless-stated rule)
  },
  {
    id: 'client-person-alias', today: '2026-06-08', clientName: 'Imtinan Qureshi', source: 'whatsapp_export',
    note: '[08/06/2026, 09:10] Bubu DXB: morning! just checking in, no rush on anything.\\n[08/06/2026, 09:12] Me: Morning, all well here.',
    expected: { ...empty,
      summary: 'Casual check-in from the client; nothing actionable.',
      people: [{ name: 'Imtinan Qureshi', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
    }, // the counterpart appears under the REAL client name, never the chat alias "Bubu DXB"
    forbidden: ['Bubu DXB', 'Bubu'],
  },
  {
    id: 'client-person-org-negative', today: '2026-07-09', clientName: 'Meridian Corp', source: 'voice',
    note: 'Called Meridian Corp, spoke to Jordan about the renewal. Nothing decided yet.',
    expected: { ...empty,
      summary: 'Called Meridian Corp and spoke to Jordan about the renewal; nothing decided yet.',
      people: [{ name: 'Jordan', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
    }, // ORG client (Meridian Corp) is an account, NOT a person — only the named individual Jordan appears
  },
"""
# insert before the final "];" that closes the EVAL_NOTES array
idx = src.rfind('\n];')
if idx == -1:
    print('ERROR: could not find EVAL_NOTES close'); sys.exit(1)
src = src[:idx] + '\n' + NEW + src[idx+1:]

path.write_text(src)
print('applied: 7 client additions + 3 new fixtures')
