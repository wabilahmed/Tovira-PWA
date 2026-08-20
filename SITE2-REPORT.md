# SITE2 — Landing v2 build report

The marketing site is rebuilt as a single narrative funnel **inside the PWA**,
**light-first** (brand v1.2 "The Ledger"). Five commits on `main`:

| # | Commit | ID |
|---|---|---|
| 1 | `style(LIGHT-FIRST)` — flip the default material to Ledger | `2d17772` |
| 2 | `refactor(SITE-MERGE)` — absorb apps/site into the PWA, prerendered + code-split | `e044e7d` |
| 3 | `feat(SITE2-STRUCTURE)` — the §1–§10 funnel, two layouts, reveal system | `78c95e4` |
| 4 | `feat(SITE2-VISUALS)` — og.png raster | `e594074` |
| 5 | `fix(SITE2-AR)` + `test(SITE2)` — /ar scaffold + regression/motion suite + this report | *(this commit)* |

**Suite: 992 green · typecheck + lint clean · production build clean · terraform validate ok.**

---

## Marketing-route JS — before / after the merge

| | Marketing entry JS | App bundle on the marketing route |
|---|---|---|
| **Before** (standalone `apps/site`, vanilla HTML + `ref.ts`) | ~0.5 kB gzip | none |
| **Naïve merge risk** (landing rendered by the React app) | — | **~69 kB gzip** (the whole app) |
| **After** (this build — vanilla static HTML + `main.ts`) | **0.98 kB gzip** (`main.js` 2.39 kB raw) | **none** |

The merge did **not** balloon the marketing payload. The landing ships tiny
static HTML + a ~1 kB module (referral + logged-in redirect + reveal + §4 frame
swap + mobile CTA); the app chunk (`app.js`, 69 kB gzip) is a **separate entry**
loaded only for `/app`. No framework runtime on the marketing route, no animation
library, fonts still subset + self-hosted.

## Prerender + no-JS verification

- The marketing routes are authored as **static HTML** (no React/SSR) — content
  is in the served file, so it is present **before hydration** and **visible with
  JS disabled**. Verified against `dist/`: `index.html` contains every funnel
  section ("Forty clients…", "Forgetting is silent", "One price…", …); `/privacy`
  + `/terms` carry their `LAWYER REVIEW REQUIRED` skeletons; `/ar` is `dir="rtl"`.
- Reveal-hidden states are **gated on `.js`** (added synchronously in the page
  head). With no JS the `.js` rules never apply → all content visible.
  `site2.test.ts` asserts every `opacity:0` reveal rule is scoped under `.js`.

## Code-split assertion

`marketing-bundle.test.ts` walks the marketing entry's import graph
(`main.ts → ref.ts, reveal.ts`) and asserts it **stays under `src/marketing` and
never imports app code or React**. Confirmed in the build: `main.js` contains no
`createRoot` / `ClientsClient` / `BillingClient`.

## Referral (the growth loop) — test results

`ref.test.ts` (10) green: `?ref=` + `utm_*` carried to **every** `[data-cta]`
(nav, hero, plans, close, **sticky mobile bar**) and the `[data-langswitch]`;
**no stray query when absent**; CTAs are plain relative `/app` links that work
**with no JS**; the `/ar ⇄ /` switch preserves params.

## Contrast — both themes (the guardrail)

`contrast.test.ts` (8) green for **Ledger (light, default)** and **Vault (dark)**:
primary body text clears **AAA (7.0)** on base/raised/elevated; secondary clears
**AA (4.5)**; brass/claret/amber/green clear the **3.0** UI floor; brass-ink on a
brass fill clears **AA**. The test caught brass-600 (#9C7734) failing AA under a
label (3.9:1) → the light primary/fill uses **brass-700 (#8A6A2F)**, 4.68:1.

## Motion inventory (every animated element + its trigger)

All motion is a progressive enhancement, gated on `.js`, ≤200 ms, and **collapsed
to an instant final state under `prefers-reduced-motion`** (verified by
`site2.test.ts`). Nothing can stay hidden — `reveal.ts` reveals everything when
IntersectionObserver is absent (verified by `reveal.test.ts`) or via a 1.6 s
fallback timer.

| Element | Trigger | Motion |
|---|---|---|
| `[data-reveal]` blocks (each section's copy/visual) | IntersectionObserver, once, threshold 0.12 | opacity 0→1 + 12 px rise, 200 ms ease-out |
| `[data-stagger-item]` (§2 silence rows, §6 use-cases, §8 plans) | parent reveal | 60 ms staggered cascade |
| `[data-deal-item]` (§5 the three proof chits — the signature moment) | parent reveal | 60 ms deal-out, ~200 ms total |
| §4 phone screen (`.how__screen`) | `.step` enters view (IO, threshold 0.5) | active screen swaps; the frame is `position: sticky` on desktop |
| Mobile sticky CTA (`[data-mobile-cta]`) | hero scrolls out of view (IO) | slides up (`transform`), 180 ms |
| CTA / links hover-focus | pointer/keyboard | background + 1 px transform, ≤150 ms |

**Still banned, and absent:** parallax, scroll-jacking, autoplay video, number
counters, confetti, looping/infinite animation, anything that moves without the
user causing it.

## Two layouts (designed, not merely responsive)

- **Mobile (<768 px):** single column, generous rhythm, a **sticky bottom trial
  CTA** that appears after the hero; 44 px targets; visuals full-bleed below copy.
- **Desktop (≥1024 px):** ~1120 px measure, **alternating two-column zigzag**
  (copy/visual then reversed); §4 **pins** the phone frame while the three steps
  scroll and **swaps its screen per step**; §6 three columns, §8 two columns, §9
  FAQ opens as a two-column list.
- **Tablet (768–1023 px):** the mobile stack at a wider measure.
Both render in **Ledger (light, default)** and **Vault (dark)** via
`prefers-color-scheme` / the Settings override.

## Visuals — built, not sourced

Every visual is **live DOM from `packages/brand`** primitives — the receipt-chit
(hero brief, proof chits, use-case + Ask evidence), the claret silence rows, a
**CSS phone bezel** (no bitmap). No photography, no stock people, no icon packs,
no "AI sparkle". The **one raster** — `og.png` (1200×630) — is generated from
`og.svg` by `apps/web/scripts/gen-og.mjs` (`npm run gen:og -w apps/web`; `sharp`
is a build-time devDep, never shipped). `og:image` = `og.png` primary, `og.svg`
secondary.

## Arabic (`/ar`) — placeholders awaiting a copywriter

`/ar` is the **RTL scaffold**, not machine-translated. It carries **10
`TRANSLATION NEEDED` markers** (one per funnel section §1–§10), each with its
**English source pinned LTR/`lang="en"`** for a native copywriter, plus a live
**RTL + bidi receipt sample** (Arabic run holding the Latin brand term "Tovira"
and "AED 299"; the mono stamp stays LTR — §3 bidi rule). The language switch
returns to `/` and carries the referral params. **No invented Arabic marketing
copy.** Still needs a native copywriter for: the hero headline, all 10 sections,
and the `<title>` / `<meta description>` (currently English placeholders).

## Must-not-regress — checked

Referral pass-through (ported, green) · `/privacy` + `/terms` on both languages ·
one-source brand tokens (`packages/brand`) · `apps/web` product behaviour + its
tests · reduced-motion + no-JS readability · the installed PWA
(`start_url=/app`), its `share_target` (→ `/app?shared=chat`), and SW updates
(marketing NetworkFirst, app-shell fallback, skip-waiting/reload preserved).

## BLOCKERS.md

Nothing a coding agent can resolve. The one human item is the **Arabic copy**
(native copywriter), tracked on `/ar` itself via the `TRANSLATION NEEDED` markers.
