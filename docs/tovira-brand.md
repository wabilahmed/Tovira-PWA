# Tovira — Brand Guideline (v1.0)

**Direction: The Private Vault.** Tovira is the discreet professional's asset —
the register of a private bank. It guards a salesperson's most valuable
possession: their client relationships. Everything below derives from that one
sentence.

This file is the single source of truth for visual and verbal identity. The
frontend implements these tokens exactly. Human-owned: the agent reads it,
never edits it.

---

## 1. Brand idea

**One line:** *Your client book is an asset. Tovira is where it's kept.*

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

*v1.0 — direction locked: The Private Vault. Tokens above are the contract;
propose changes here first, then implement.*
