# Tovira — Brand Guideline (v1.3)

**Direction (v1.3): The Ledger — light-first, tovira.io palette.** See §11
(light-first) and §12 (the palette adopted from the live site). The design system
below — type, receipt-chit, spacing, motion, voice, refusals, and the SEMANTIC
colour rules — is unchanged; §12 moves the HUES only, and §2/§11 hex values are
superseded by §12's table.

**Original direction (v1.0–v1.1): The Private Vault.** Tovira is the discreet professional's asset —
the register of a private bank. It guards a salesperson's most valuable
possession: their client relationships. Everything below derives from that one
sentence.

This file is the single source of truth for visual and verbal identity. The
frontend implements these tokens exactly. Human-owned: the agent reads it,
never edits it.

---

## 1. Brand idea

**One line:** *Your client book is an asset. Tovira is where it's kept.*

**The behavioral pitch:** *Tovira speaks rarely. When it speaks, act.*

**Personality (in order):** discreet · precise · assured · warm-in-private.
Never: playful, loud, salesy, apologetic, cute.

**The metaphor set** (where all visual/verbal choices come from): the private
bank — the vault, the ledger, the receipt, the statement of holdings, the
banker's red ink. NOT: rockets, sparkles, robots, lightning bolts, confetti.

**The two materials.** A private bank has two surfaces: the vault interior and
ledger paper. Tovira ships both as themes sharing one palette:
- **Vault (dark)** — default; the app's identity.
- **Ledger (light)** — daylight legibility for a rep outdoors; auto-switch by
  system preference, manual override in Settings.
Every component must be designed against both.

---

## 2. Color tokens

### Core palette (named, fixed)
| Token | Hex | Use |
|---|---|---|
| `ink-950` | `#16130F` | Vault base surface (warm near-black, leather-leaning — NOT pure/blue black) |
| `ink-900` | `#1E1A15` | Vault raised surface (cards) |
| `ink-800` | `#28231C` | Vault elevated (sheets, modals) |
| `ink-700` | `#3A342B` | Hairlines/borders on Vault |
| `parchment-100` | `#EFEAE0` | Primary text on Vault; Ledger base surface |
| `parchment-200` | `#E5DFD2` | Ledger raised surface |
| `parchment-400` | `#B9B2A2` | Secondary text on Vault |
| `ink-text` | `#1C1812` | Primary text on Ledger |
| `brass-500` | `#B3893F` | THE accent. Value & interactivity on Vault |
| `brass-700` | `#8A6A2F` | Brass on Ledger (darkened for contrast) |
| `claret-500` | `#9E3B33` | Banker's red ink — action needed / overdue / cooling |
| `ledger-green-500` | `#4F6F58` | Confirmed / kept / on-track (muted, never neon) |
| `amber-500` | `#B07A2A` | Low-confidence / needs review (used sparingly) |

### Rules
- **Brass is earned.** It appears only on: primary actions, value moments
  (corpus counter, ledger totals, pattern unlocks), focus rings, and active
  states. Never as decoration, never on more than one competing element per
  view.
- **Claret means "act."** It appears ONLY on things requiring action: overdue
  promises, cooling clients, unanswered questions, destructive confirms. If
  everything is claret, nothing is. Calm states stay ink/parchment.
- **No gradients** except a single barely-there vignette permitted on the Vault
  base (≤4% luminance shift). No glassmorphism, no glows, no neon.
- **Contrast floor:** body text AA at minimum, AAA target
  (`parchment-100` on `ink-950` passes AAA). Verify every claret/brass pairing.

---

## 3. Typography

**System:** authority from a stern serif, workhorse from an institutional sans
with a first-class Arabic companion, precision from a mono for data.

| Role | Face | Notes |
|---|---|---|
| Display / headings | **Fraunces** (variable) | Set stern: `SOFT 0, WONK 0`, optical size high. Weights 500–600. The banker's serif — contracts and letterheads, not wedding invitations. |
| Body & UI (Latin) | **IBM Plex Sans** | 400/500/600. Neutral-institutional; disappears into the work. |
| Body & UI (Arabic) | **IBM Plex Sans Arabic** | The matching companion — Arabic is designed, never a fallback font. Match weights 1:1 with Latin. |
| Data / receipts / timestamps | **IBM Plex Mono** | Tabular by nature. All dates, counts, AED figures, receipt stamps. |

### Type rules
- Fraunces for page titles, section heads, and the Book Scan / Monday Scan
  headlines only. Never for buttons, labels, or body.
- **All numbers that mean money, dates, or counts are Plex Mono** — the ledger
  register. AED figures always as `AED 12,400` (mono, space, no symbol art).
- Type scale (rem): 2.0 / 1.5 / 1.25 / 1.0 / 0.875 / 0.75. Line-height 1.5
  body, 1.2 display. Sentence case everywhere; no all-caps except tiny
  receipt stamps (see §5).
- RTL is a first-class layout mode: mirrored layouts, correct bidi for mixed
  Arabic-English strings (common in this product), logical CSS properties
  (`margin-inline-start`, not `margin-left`).

---

## 4. Space, shape, depth, motion

- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48. Generous by default —
  the vault is never crowded. Minimum tap target 44px.
- **Radius:** 6px cards & inputs, 4px chips, 999px only for avatars. No large
  soft radii — this is a ledger, not a toy.
- **Borders over shadows.** Depth comes from surface steps (ink-950 → 900 →
  800) plus 1px hairlines (`ink-700` / `parchment-400` at 40%). Shadows only
  on overlays: `0 8px 24px rgb(0 0 0 / 0.35)` max.
- **Motion:** 150–200ms, ease-out, opacity+translate only. One orchestrated
  moment in the whole app: **the Book Scan reveal** — findings deal out like
  an audit delivered across a desk (staggered 60ms, ~400ms total). Everything
  else is instant and quiet. `prefers-reduced-motion` fully respected: all
  non-essential motion off.

---

## 5. The signature: the Receipt

Every fact Tovira asserts shows its evidence — that doctrine becomes the
visual signature. **The receipt-chit** is a distinct, instantly recognizable
component used wherever a quote+date backs a claim (briefs, Book Scan, recall
answers, ledger entries):

- A slip on the raised surface with a **perforated top edge** (dotted 1px
  hairline), content inset 12px.
- The quote in body sans (or Arabic companion), the **date + source as a
  small mono "stamp" line**, letterspaced caps, `parchment-400`:
  `WHATSAPP · 14 MAR 2026`.
- A 2px **brass tick on the left edge** — the only brass on the chit.
- Tapping a receipt always opens the source message in the timeline.

Do not restyle receipts per feature. One chit, everywhere — it is the brand.

**Second signature (small): the Statement of Holdings.** The corpus counter
("14 months · 2,300 moments") is set like a bank statement line: Fraunces
number, mono label, brass rule above. It appears on the home screen and
Settings — nowhere else.

---

## 6. Component register (how the brand lands per screen)

- **Today / priorities:** a numbered register, not cards-with-icons. Each line:
  mono index, action in body sans, claret dot ONLY if overdue/cooling.
- **Pre-meeting brief:** reads as a prepared memo — Fraunces client name,
  sectioned by hairlines, receipts inline. No emoji, no avatars of "AI".
- **Book Scan / Monday Scan:** the audit. Fraunces headline ("What your book
  has been hiding"), findings as receipt-chits, totals in mono. The one
  animated moment (see §4).
- **Recovered Value Ledger:** literally a ledger table — mono figures,
  hairline rows, brass total rule. "Touched" language per spec; AED only when
  rep-entered (the guideline inherits the honesty rules; design never
  decorates them away).
- **Alerts / cold list:** claret used exactly as §2 dictates; entries carry
  the receipt of *why* (last contact date, mono).
- **Confirmation queue:** amber left-edge tick on unconfirmed chits; a
  confirmed item's tick turns brass. Uncertainty is visible, never scary.
- **Paywall / billing:** the most restrained screen in the app. Price as
  `AED 299 / month` in mono, one brass button, no urgency banners, no
  countdown timers, no strike-through fake prices. A vault does not discount
  loudly.

---

## 7. Voice & writing

- **Register:** measured, few words, informs — never cheers. No exclamation
  marks anywhere in product UI. No emoji in UI copy (reps' own content keeps
  its emoji untouched).
- Buttons say exactly what happens: "Save note", "Run scan", "Open in
  WhatsApp". The same verb persists through its flow.
- Numbers speak for themselves: "3 promises due" — never "You've got 3
  promises due! 💪".
- Errors: what happened + what to do, one sentence each, no apology.
  Empty states are invitations with one clear action, in-world:
  *"Nothing on file yet. Import a chat to open the book."*
- Bilingual copy: code-switching is respected, not corrected. Arabic UI
  strings are written natively, not machine-translated Latin sentence
  structure.
- Marketing may warm up slightly; product UI never does.

---

## 8. Logo & mark (direction, pending final art)

Wordmark: "Tovira" in Fraunces 600, tight tracking, `parchment-100` on Vault /
`ink-text` on Ledger. Monogram for icons: a "T" whose crossbar is a brass
ledger rule. App icon: monogram on `ink-950`, brass mark — no gradients, no
badge shine.

---

## 9. Do / Don't (the short version for reviews)

**Do:** two materials, one palette · brass earned, claret only for action ·
receipts everywhere a claim is made · mono for every number that matters ·
Arabic as designed type · space and silence.

**Don't:** gradients, glows, neon, glassmorphism · emoji or exclamation marks
in UI · more than one brass element competing per view · claret as decoration ·
urgency-marketing patterns (timers, fake discounts) · icon soup · any
"AI sparkle" iconography — Tovira presents as a bank, not a bot.

---

## 10. Premium & necessity codex (v1.1)

Premium is subtraction and finish, not added luxury. Necessity is stakes and
ritual, not urgency banners. These rules are as binding as the tokens.

### Finish rules (precision you can feel)
- **Tabular numerals everywhere numbers appear**; AED columns decimal-aligned.
- Real typographic punctuation: `·` separators, en-dashes for ranges, proper
  Arabic punctuation — never straight-quote approximations.
- Mono stamps baseline-aligned with their body text; hairlines render at a true
  1px on every device density.
- Dates in one format app-wide: `14 MAR 2026` (mono, caps) in stamps;
  `14 Mar 2026` in body copy. No "3/14/26" anywhere, ever.

### The silence budget (premium behavior, not just premium looks)
- **Maximum 2 push notifications per rep per day**, ranked server-side.
  Everything else waits for the Statement or the app open.
- No notification ever asks for engagement ("come back!", "we miss you") —
  only states a fact that warrants action.
- One haptic in the whole app: a single soft confirm tick on promise-kept /
  note-saved. No sounds, ever.

### Product naming register (internal story name → in-product name)
| Internal (docs/stories) | In-product |
|---|---|
| Monday Morning Scan (P3-8) | **The Monday Statement** |
| "What should I do today?" (P4b-3) | **Today's register** |
| Recovered Value Ledger (P4-11) | **The Ledger** |
| Corpus counter (P4-10) | **Statement of holdings** |
| Book Scan (P5-3b) | **The Book Scan** (unchanged — already in-world) |
Docs and story IDs keep internal names; UI copy uses in-product names. This
table is the mapping — no other renames are implied.

### Stakes made visible (necessity)
- **Silent-days counter:** cooling clients show elapsed silence as a claret
  mono counter — `Falcon Group · silent 21 days` — ticking until acted on.
  Elapsed time is a fact, so this passes the honesty rules; it is the one
  place claret is allowed to dominate a row.
- **Possession language everywhere:** "your book", "your vault holds…",
  "on file since MAR 2026" (small mono line in the client header). The corpus
  is a holding, not a stat.
- **Onboarding is account-opening:** deliberate pace, few words, and the vault
  visually opens on first import — folded into the Book Scan reveal (the one
  animated moment; no second animation added).
- **The share card is a statement excerpt:** counts-only (per P5-6 tests),
  styled as a redacted register clipping — never a social badge.

### Refusals (absence as positioning — banned by name)
- No streaks, badges, confetti, progress-bars-for-their-own-sake, or
  "you're on fire" copy. Tovira does not gamify a professional's client book.
- No urgency marketing anywhere: no countdown timers, no fake discounts, no
  "only today" — including notifications and email.
- **No emoji in product UI** (restating §7 because it was violated once:
  the corpus badge's 🧠 must go — the Statement of holdings is typography,
  not a brain emoji).

---

## 11. v1.2 — Light-first revision (amends §1 and §2)

**Why:** the Vault default read as too dark for daily, outdoor, one-handed use.
Premium does not require darkness — a private bank is a dark vault *and* a
bright room full of ledger paper. We are moving to the paper.

### The default flips
- **Ledger (light) is now the default material.** It is what a stranger sees on
  the landing page and what a rep gets on first run.
- **Vault (dark) is retained** as a full, equal theme — selected by
  `prefers-color-scheme: dark` or manually in Settings. It is not deprecated;
  every component is still designed against both.
- Nothing about the identity changes: same type system, same receipt-chit, same
  brass-is-earned and claret-means-act rules, same refusals.

### Added / revised tokens (light surfaces)
| Token | Hex | Use |
|---|---|---|
| `canvas-50` | `#FBF9F5` | **NEW — the default page surface.** A clean warm white; brighter and more inviting than parchment. |
| `parchment-100` | `#EFEAE0` | Raised surface on light (cards, panels) — was the base, now a step up |
| `parchment-200` | `#E5DFD2` | Sunken/inset areas, table row banding |
| `ink-text` | `#1C1812` | Primary text on light |
| `ink-600` | `#5F5A4E` | Secondary text on light (replaces using parchment-400 on light) |
| `hairline-light` | `#D8D2C4` | Borders/rules on light — softer than the old parchment-400 |
| `brass-600` | `#9C7734` | Brass on light: accents, value moments, primary buttons |
| `brass-700` | `#8A6A2F` | Brass text on light where more contrast is needed |
| `claret-500` | `#9E3B33` | Unchanged — action needed |
| `ledger-green-500` | `#4F6F58` | Unchanged — confirmed / kept |
| `amber-600` | `#96661F` | Uncertain / needs review, darkened for light surfaces |

All Vault (dark) tokens in §2 remain exactly as specified.

### Warmth rules (what "inviting" means here — it is not decoration)
- **More air, not more color.** Increase default section padding one step on the
  scale before reaching for any new hue.
- **Softer separation:** prefer whitespace and `hairline-light` over boxes;
  cards get a surface step, not a shadow.
- **Radius stays 6px**, but full-bleed panels on light may use 8px.
- **Contrast floor is unchanged** — AA minimum, AAA target for body. Verify
  every light-surface pairing; a warm palette makes it easy to drift into
  low-contrast gray-on-cream, which is the failure mode to avoid.
- Brass on light must read as a considered accent, never as yellow highlighter.

### What does not change
Brass is still earned. Claret still means act. Receipts still carry every
claim. Numbers are still mono and tabular. No gradients, glows, glassmorphism,
emoji, exclamation marks, gamification, or urgency patterns.

---

*v1.2 — direction: The Ledger (light-first), with Vault retained as the dark
theme. Tokens and codex above are the contract; propose changes here first,
then implement.*

---

## 12. v1.3 — tovira.io palette (supersedes the §2/§11 hex values)

**What changed:** the HUES only, adopted from the live site **tovira.io** (a warm
terracotta accent on paper). **Nothing else moves** — the direction ("The Private
Vault / Ledger"), the type system, the receipt-chit, spacing, motion, voice, the
refusals, and the semantic colour rules (§2) all stand. Brass is still earned;
claret still means *act*; amber still means *uncertain*; the three stay distinct.
Ledger (light) remains the default; Vault (dark) is **derived** from the same
identity (not inverted). Verified in both themes by `contrast.test.ts`.

### Ledger (light) — from tovira.io's own tokens
| Role | Token | Hex | tovira.io source |
|---|---|---|---|
| Page surface | `--surface-base` | `#F4F1EA` | `brand-paper` |
| Raised (cards) | `--surface-raised` | `#FAF7EF` | `brand-card` |
| Banded/sheets | `--surface-elevated` | `#EDE8DC` | a step deeper |
| Hairline | `--hairline` | `#D6CFBD` | `brand-line` |
| Primary text | `--text-primary` | `#1C1917` | `brand-ink` |
| Secondary text | `--text-secondary` | `#6B645D` | `brand-muted` #78716C **darkened for AA** |
| Accent / primary action | `--brass` | `#D14821` | `brand-accent` |
| Accent hover | `--brass-strong` | `#C0411D` | accent-dark |
| Text on accent | `--brass-ink` | `#FFFFFF` | — |
| Action-needed | `--claret` | `#9E3B33` | **kept** (site has no distinct danger) |
| Confirmed / kept | `--green` | `#4A7C59` | `brand-success` |
| Uncertain / review | `--amber` | `#96661F` | **kept** (site warning #FCD34D fails AA as text; used as a surface tint only) |
| Shadow | `--shadow-overlay` | `0 8px 32px -8px rgba(28,25,23,0.12)` | `shadow-card` |

### Vault (dark) — derived, same identity in a low light
| Role | Token | Hex |
|---|---|---|
| Base / raised / elevated | `--surface-*` | `#1B1512` / `#241D18` / `#2E2620` (warm terracotta-tinted near-blacks) |
| Hairline | `--hairline` | `#3D332A` |
| Primary / secondary text | `--text-*` | `#F4F1EA` / `#B8AB9C` (off-white, never pure #FFF) |
| Accent (lifted) | `--brass` / `--brass-strong` / `--brass-ink` | `#E8724A` / `#F08A63` / `#1B1512` |
| Action-needed | `--claret` | `#D9766D` |
| Confirmed | `--green` | `#7FA98C` |
| Uncertain | `--amber` | `#DBA75A` |

### AA notes (source palette gaps we corrected)
- tovira.io's muted text `#78716C` on its paper `#F4F1EA` is **4.30:1** — below the
  4.5 AA floor for body text. Darkened to `#6B645D` (≥4.5 on every light surface).
- tovira.io's warning `#FCD34D` (bright yellow) cannot meet AA as text on paper;
  our amber stays `#96661F` for the "uncertain" role, and `#FCD34D` tints the
  amber surface only.
- tovira.io has no distinct danger hue (its accent doubles as the alert). Since
  the accent must stay distinct from "act", `--claret` is **kept** at `#9E3B33`.

*v1.3 — direction unchanged (The Ledger, light-first, Vault retained); only the
hues moved to the tovira.io palette. Tokens above are the contract.*
