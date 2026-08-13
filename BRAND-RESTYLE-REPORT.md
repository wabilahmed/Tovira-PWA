# Brand Restyle Report — The Private Vault (v1.1)

Five commits, one per task, worked in order. Full suite green (746 tests),
typecheck + lint clean, Vite production build clean. No feature or endpoint
behavior changed except the two sanctioned items below. Existing tests were
not weakened; the only test edits are copy renames from the naming/finish
register, each listed here.

| Task | Commit |
|---|---|
| `style(TOKENS)` | `0f6469e` |
| `feat(RECEIPT)` | `31bd567` |
| `style(NAV-NAMES)` | `e505eb2` |
| `style(SCREENS)` | `da4cc4f` |
| `style(VOICE)` | `160bac2` |

The Vault/Ledger tokens, self-hosted fonts (Fraunces + IBM Plex Sans/Arabic/Mono),
logical properties, reduced-motion handling, and the base component pass landed
in the prior two brand commits (`03bfff1`, `5e349c0`); this batch formalised and
extended them.

---

## Sanctioned test updates (copy renames only)

| Test | Before → After | Why |
|---|---|---|
| `promises/PromisesTracker.test.tsx` | `due 2026-08-01` → `due 1 Aug 2026` | §10 finish rule: one date format (`14 Mar 2026` body); no ISO/slash dates in UI |
| `billing/Billing.test.tsx` | `AED 2,990/yr` → `AED 2,990 / year` (and the negative guard `2,990/mo` → `2,990 / month`) | §6 price form `AED 2,990 / year` |

No other test was changed. The nav rename (Task 3) required **zero** test edits:
the only nav assertion (`App.test` navigates via `/today/i`) still matches
"Today's register", and nothing asserted the old "Week"/"Value" strings. The
voice sweep (Task 5) changed strings still matched by existing case-insensitive
substrings (`/copied/i`, `/saved/i`, `/clear week/i`).

---

## Before → after, per screen (screenshots not capturable in this environment; described)

- **Login** — was a bare centered form on the page background. Now a restrained
  vault card: Fraunces "Tovira" wordmark, a mono-quiet tagline ("Your client
  book, kept."), one brass primary action; the mode toggle is a quiet link.
- **Clients / Client detail** — client header now carries a mono possession
  line, "on file since MON YYYY" (from the client's on-file date, no server
  change). The **Brief reads as a prepared memo**: Fraunces client name, a
  "pre-meeting brief" stamp, mono section labels, hairline-ruled sections; due
  dates formatted `1 Aug 2026`. Card scan preview is a vault card with the one
  brass confirm; notes timeline uses mono capture stamps.
- **Today's register** — numbered register rows (mono index), a claret dot only
  on cooling/overdue actions; the warming-up panel is a solid quiet vault card
  (was a dashed box); heading + nav renamed to "Today's register".
- **The Monday Statement** — renamed from "Week"; Fraunces headline, sections
  ruled by hairlines with mono section counts; loading/error copy uses the
  in-product name.
- **Ask** — answers as prose; receipts are now the shared Receipt-chit
  (perforated top, brass tick, mono `DD MON YYYY` stamp). The "I don't have that
  on record" state is plain text, not error-red.
- **Promises** — register rows; due dates in mono body form; **overdue promises
  carry a claret dot and claret stamp** (client-side from the due date); the
  confirm queue shows an amber dot, resolving on confirm/reject.
- **Alerts** — cooling entries render the **silent-days counter**
  `Name · silent N days` in claret mono, derived client-side from the
  last-contact date; alerts carry a claret action dot.
- **Book Scan** — the one animated moment: findings deal out staggered ~400ms
  (reduced-motion honored); every finding is a Receipt-chit; the **share card is
  a redacted statement excerpt** under a brass rule — counts only (P5-6 privacy
  assertions untouched).
- **The Ledger** — renamed from "Value"; ledger table with mono figures, hairline
  rows, a brass statement rule on the headline. "Touched" copy untouched.
- **Settings / Billing** — the most restrained screen: `AED 299 / month` and
  `AED 2,990 / year` in mono, one brass button, no urgency patterns; plus the
  Appearance toggle (System / Vault / Ledger, persisted).
- **Statement of holdings (corpus badge)** — the 🧠 emoji is gone; rendered as a
  bank-statement line (mono figures under a brass rule), hidden when zero.

### New shared pieces
- `components/Receipt.tsx` — the one receipt-chit (brand §5); `data-testid="receipt"`;
  becomes a real button that opens the source when given `onOpen`.
- `format/dates.ts` — the single date formatter (`formatStamp` / `formatBody` /
  `formatMonthYear`) + `daysSince`; timezone-stable, never emits a slash date.
- `styles/contrast.test.ts` — parses the shipped `theme.css` and holds the §2
  contrast floor (AA text, 3.0 accents) on both materials.
- Global `font-variant-numeric: tabular-nums` (§10 finish rule).

### Where the receipt was intentionally NOT applied
The Ledger shows aggregate figures (not quotes), and the Brief / Monday Statement
payloads carry no dated quotes — there is nothing to convert to a Receipt there,
so those screens keep their register/memo layouts. Book Scan receipt `onOpen`
navigation is left unwired pending a timeline-scroll target (the component
already supports it).

---

## Flagged follow-ups (out of this batch, so they aren't lost)

1. **Silence budget — max 2 push notifications / rep / day, ranked server-side
   (§10).** A server task: a per-rep daily send cap + a ranking pass in the scan
   scheduler, not a copy change. The in-app cold list and the Monday Statement
   already carry everything without pushing.
2. **Single confirm haptic on promise-kept / note-saved (§10).** Needs a device
   decision (Web Vibration API vs a native shell), so deferred until the target
   is chosen. No sounds, ever, per the codex.

Both are noted only; neither was implemented in this styling batch.

---

## Definition of done
- [x] Five commits with the given IDs.
- [x] Full suite green (746), typecheck + lint clean, Vite build clean.
- [x] No feature/endpoint change except: the "on file since" client-header line
      (derived from existing client data, no server change) and the copy renames.
- [x] This report: per-screen before/after, every sanctioned test update, and the
      flagged follow-ups.
