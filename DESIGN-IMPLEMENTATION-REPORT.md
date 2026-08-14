# Design Implementation Report — Tovira Redesign Board (Private Vault v1.1)

Implements the Claude Design board (`Tovira Redesign Board.dc.html`, imported via the
`claude_design` MCP): a mobile-first product (390px) with a responsive desktop layer
(≥1180px), across every screen in both materials. Delivered as **full build, one pass,
responsive** per the user's choice. Six commits; full suite green; typecheck, lint and
the Vite production build clean.

The board's palette/type/finish rules are identical to the v1.1 brand doc already
implemented, so the tokens, self-hosted fonts and register/statement/stamp/dot
primitives were reused — this batch adds the **layout architecture** the board defines.

| Phase | Commit |
|---|---|
| Responsive shell (bottom tabs + sidebar) | `098c3f9` |
| Bilingual Receipt (Arabic/RTL) | `b46301b` |
| Hero screens (Book Scan · Today · Brief · Monday) | `aed10e3` |
| Supporting screens (Alerts · Ask · Promises · Settings · Clients) | `72a6686` |
| Desktop split + report | this commit |

---

## What changed, per screen (screenshots not capturable here; described)

**Shell** — the top text-nav is gone. Mobile: a centred app frame, content scrolling
above a pinned bottom **tab bar** (Clients · Today's register · Ask · Book Scan · More);
the active tab carries a 2px brass top rule; the fourth slot yields to the active
overflow section; More opens a sheet. Desktop (≥1180px): a **sidebar** (Fraunces wordmark
+ full nav, active = brass inline-start rule) and a content pane. `useIsDesktop` defaults
to mobile when `matchMedia` is absent, so tests see one nav.

**Book Scan** — Fraunces headline "What your book has been hiding" over a mono meta line;
findings grouped into ruled sections (Open promises / Unanswered questions / Going quiet /
Dates ahead) with mono counts; each a Receipt-chit; "silent N days" (claret) on cooling
findings; the one staggered deal-out reveal.

**Today's register** — mono meta "N entries · M need acting on"; numbered register (mono
index, claret dot only on cooling/overdue); the warming-up panel states the gate as mono
fractions ("Clients on file 06 / 08", "Notes captured 34 / 60"), no progress bar.

**Pre-meeting brief** — a prepared memo: Fraunces client name, "on file since MON YYYY ·
N moments", hairline sections with mono labels; People render as **decides / influences /
blocks** (blocks the one claret role); Recent context as **bilingual Receipt-chits**.

**The Monday Statement** — mono meta "Week of 16 Mar – 22 Mar 2026 · N entries" (en-dash);
four ruled sections with mono counts + a right-aligned mono date column; unanswered
questions as Receipt-chits; "A clear week." with no brass.

**Alerts** — mono meta; "Needs you" + "Going quiet" mono-stamp sections with counts and
the **silent-days counter** (claret mono); one honest combined quiet state; the Rescan verb.

**Ask** — an "On record" provenance stamp above answers with receipts; a bare "I don't
have that on record" stays calm and unlabelled; "Ask your book…"; "Voice" as a word.

**Promises** — register rows, claret dot + claret due stamp on overdue; header counts
"N open · N overdue · N to confirm"; amber confirm queue.

**Clients** — rows carry "on file since MON YYYY"; **desktop split view** (list rail +
detail pane; mobile still pushes the detail full-screen); the corpus **Statement of
holdings** on the home header and in Settings (no 🧠 emoji).

**Settings/Billing** — restrained: `AED 299 / month`, `AED 2,990 / year` in mono, one
brass action; Appearance toggle (System / Vault / Ledger); delete in claret.

**Bilingual** — the one Receipt-chit reads Arabic RTL in guillemets « » with Arabic body
leading (`--leading-arabic`), while a mostly-English quote (even with an inline Arabic
phrase) stays LTR; the mono stamp always stays LTR/left.

## Token proposals honoured (from the board annotations)
- **Active-nav 2px brass rule** — implemented as the tab/sidebar active indicator (a
  state marker, not a competing brass element).
- **`--leading-arabic` (1.6)** + **`--font-arabic`** — the Arabic body line-height token.
- Ledger secondary contrast (`#5C5647` on `#EFEAE0`) already holds via `--text-secondary`.

## Sanctioned test updates (nav restructure + board copy)
- `App.test`: overflow-screen navigations (Promises, Alerts, Meetings, Settings) open
  "More" first; the Ask submit is scoped to its region (the tab bar moved below content);
  added a desktop-sidebar test. New shell tests (`TabBar`, `AppShell`) and bilingual/
  `formatRange` tests were added.
- `HeroInsights.test`: empty copy `/nothing urgent/` → `/nothing on the register/`.
- `Alerts.test`: two empty-section assertions → one combined quiet-state assertion;
  `refresh` → `rescan`.
No `data-testid` or behavioural assertion was weakened.

## Payload gaps (rendered gracefully, no server change)
The board shows a few facts the current API payloads don't carry; these are omitted
rather than faked, and are candidate future server fields:
- **Book Scan** meta "N chats read" (only findings + clients are derivable).
- **Today's register** per-row sub-lines ("overdue since…", "silent N days", "unanswered
  N days") — `/today` returns action text only.
- **The Monday Statement** cooling-client silent-days — `coolingClients` carries only
  `{id, name}` (no `lastTouchedAt`).
- **Billing** active-plan renewal date — `entitlement` returns status + trialEndsAt only.

## Partially addressed (flagged)
- **Capture** is not a top-level screen in the app (recording is per-client in the client
  detail, import via ImportChat); both already carry the v1.1 tokens (claret Stop, etc.).
  A dedicated board-style Capture screen was not introduced, as it would change the
  information architecture beyond a restyle.
- **Promises** shows the full "due DATE" (claret when overdue) rather than the board's
  dense "overdue 4d" abbreviation, to keep the existing date assertion; the claret dot +
  claret stamp still signal overdue.

## Verification
- `npm run typecheck` · `npm run lint` · `npm test` (full) green.
- `cd apps/web && npm run build` clean (self-hosted fonts bundled).
- Live at http://localhost:5173 (Docker stack up, HMR): check the bottom tab bar + More,
  Settings → Appearance for both materials, a ≥1180px window for the sidebar + Clients
  split, and an Arabic receipt in a brief.
