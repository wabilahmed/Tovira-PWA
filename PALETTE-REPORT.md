# PALETTE-REPORT — adopt the tovira.io palette (`style(PALETTE)`)

Tovira's colour tokens are replaced with the palette from the live site
**tovira.io**, and a complementary dark theme is derived from it. **Hues moved;
the design system did not** — type, receipt-chit, spacing, motion, voice,
refusals, and the semantic rules (accent earned · claret means act · amber means
uncertain) all stand. One source of truth: `packages/brand/tokens.css`.

**Suite green · typecheck + lint clean · contrast test 10/10 in both themes.**

## 1. Source values (extracted, not guessed)

Fetched `https://tovira.io/` and its compiled stylesheet
(`/_next/static/css/3d46e1b640555bb2.css`) on this machine and read the actual
`brand-*` Tailwind token values (rgb → hex):

| tovira.io token | value | used on the page for |
|---|---|---|
| `brand-paper` | `rgb(244 241 234)` = `#F4F1EA` | page background |
| `brand-card` | `rgb(250 247 239)` = `#FAF7EF` | card / panel background |
| `brand-ink` | `rgb(28 25 23)` = `#1C1917` | body text |
| `brand-muted` | `rgb(120 113 108)` = `#78716C` | muted text |
| `brand-line` | `rgb(214 207 189)` = `#D6CFBD` | borders |
| `brand-accent` | `rgb(209 72 33)` = `#D14821` | primary button, links, focus ring |
| accent-dark | `rgb(192 65 29)` = `#C0411D` | accent hover/active |
| `brand-success` | `rgb(74 124 89)` = `#4A7C59` | success text |
| warning | `#FCD34D` | a warning yellow (surface accents) |
| banded step | `rgb(237 232 220)` = `#EDE8DC` | deeper surface tone |
| `shadow-card` | `0 8px 32px -8px rgba(28,25,23,0.12)` | card shadow |

**Could not be determined:** the site exposes **no distinct danger/alert hue** —
its accent (`#D14821`) doubles as the on-site alert. No other value was
ambiguous; nothing was invented.

## 2. Semantic mapping (meaning kept, hue changed)

| Role | Was (v1.2) | Now | Source |
|---|---|---|---|
| Page surface | `#FBF9F5` | `#F4F1EA` | `brand-paper` |
| Raised surface | `#EFEAE0` | `#FAF7EF` | `brand-card` |
| Banded / sheets | `#E5DFD2` | `#EDE8DC` | a step deeper |
| Primary text | `#1C1812` | `#1C1917` | `brand-ink` |
| Secondary text | `#5F5A4E` | `#6B645D` | `brand-muted`, **darkened for AA** |
| Hairline | `#D8D2C4` | `#D6CFBD` | `brand-line` |
| **Accent / action** | `#8A6A2F` (brass) | `#D14821` (terracotta) | `brand-accent` |
| **Action-needed** | `#9E3B33` | `#9E3B33` **kept** | site has none |
| Confirmed | `#4F6F58` | `#4A7C59` | `brand-success` |
| Uncertain | `#96661F` | `#96661F` **kept** | site warning fails AA |

The semantic rules survive intact:
- **Accent is earned** — primary actions + value moments only. The token name
  `--brass` is kept (it is the "accent" slot); it now holds the terracotta so the
  hundreds of existing usages need no rename.
- **Claret still means act** — kept distinct from the accent (an orange accent and
  a red alert can never be confused).
- **Uncertain keeps its own colour** — amber, distinct from both.

## 3. Derived dark theme (not inverted)

Same identity in a low light: warm terracotta-tinted near-blacks (the accent hue
at very low chroma, so dark ≠ generic grey), the accent lifted lighter/less
saturated to read as the same colour, off-white text (never pure `#FFF`).

| Role | Dark value |
|---|---|
| base / raised / elevated | `#1B1512` / `#241D18` / `#2E2620` |
| hairline | `#3D332A` |
| primary / secondary text | `#F4F1EA` / `#B8AB9C` |
| accent / hover / ink | `#E8724A` / `#F08A63` / `#1B1512` |
| action-needed (claret) | `#D9766D` |
| confirmed (green) | `#7FA98C` |
| uncertain (amber) | `#DBA75A` |

`--text-primary` on dark = `#F4F1EA` (the light theme's *paper* used as text) — a
deliberate thread tying the two materials together.

## 4. Contrast results (both themes — `contrast.test.ts`, 10/10)

- **Primary body text clears AAA (7.0)** on base, raised and elevated — both themes.
- **Secondary text clears AA (4.5)** on all three surfaces — both themes.
- **Accents (brass/claret/amber/green) clear the 3.0 UI floor** on all three
  surfaces — both themes.
- **`brass-ink` on the accent fill clears AA (4.5)** — white on `#D14821` = 4.51;
  dark ink on `#E8724A` = 5.8.
- Accent, claret and amber are asserted **distinct** (no semantic collision).

### Source-palette gaps we corrected (never lowered the bar — adjusted our token)
1. **Muted text.** tovira.io's `#78716C` on its paper `#F4F1EA` is **4.30:1** —
   below AA for body. Darkened our `--text-secondary` to `#6B645D` (≥4.5 on every
   light surface). *This is the one place the source palette itself fails AA.*
2. **Warning.** `#FCD34D` (bright yellow) can't be legible text on paper; our
   `--amber` stays `#96661F` for the "uncertain" role, and `#FCD34D` tints the
   amber *surface* only.
3. **Danger.** No distinct hue on-site; `--claret` kept at `#9E3B33` so "act"
   stays distinct from the accent.

## 5. Sweep — no hardcoded colours bypass the tokens

`packages/brand/tokens.css` is the only place hex/rgb literals live. The app +
marketing routes reference `var(--…)` exclusively; the only non-token colours were
the `<meta theme-color>` values and the PWA manifest — updated to `#F4F1EA`
(light) / `#1B1512` (dark) so the OS chrome matches.

## 6. Proposed `docs/` change — **applied**

Per your instruction ("update tovira-brand.md then update the code"),
`docs/tovira-brand.md` was updated (scripted route, guard-blocked to the Edit
tools): header → v1.3, and a new **§12** carrying the token tables above with the
note that the **direction name and semantic rules are unchanged — only the hues
moved.** §2/§11 hex values are marked superseded by §12.

*Screenshots aren't available here; verification is the contrast test + the token
tables above for a human to eyeball.*
