# Marketing Site — Build Report (SITE-1 … SITE-5)

Agent-owned build report (repo root, like PROJECT-STATUS.md). The marketing site
lives in `apps/site` and builds/deploys independently of the product.

## What shipped

| Task | Commit | Result |
|---|---|---|
| SITE-1 scaffold + shared tokens | `c90ce7f` | apps/site (Vite MPA), `packages/brand/{tokens,primitives,fonts}.css` shared with the app |
| SITE-2 the page (§1–12) | `4404446` | verbatim copy, real Receipt chits, brass/claret/amber discipline |
| SITE-3 referral pass-through | `fac4036` | ?ref= + utm_* carried to every CTA; plain-link guarantee |
| SITE-4 Arabic /ar | `0f0c5fb` | RTL scaffold, native-translation placeholders (no invented Arabic) |
| SITE-5 meta / a11y / deploy | this commit | OG+Twitter, one-h1 landmarks, Terraform (unapplied), CI |

**Verification:** full suite **831 green** (24 new site tests); typecheck + lint
clean; `npm run build -w apps/web` and `npm run build:site` both clean.

## One source of truth for the brand

`packages/brand/tokens.css` (palette/type/scale) and `primitives.css` (base type
+ Receipt-chit, mono stamp, dots, chip, the one brass action, quiet link) were
**extracted** from the app's `theme.css`; both `apps/web` and `apps/site` import
them. The palette cannot fork. The web app is byte-identical after the extraction
(Receipt + contrast tests green, build unchanged). `contrast.test.ts` now parses
the shared tokens file, so its AA/UI-floor checks cover **both** materials for
**both** apps.

## The referral pass-through (the test that matters)

`apps/site/src/ref.test.ts` runs against the **real** shipped `index.html`, not a
fixture:
- `?ref=abc123` → present on **every** `[data-cta]` (all point at `https://app.tovira.com/`).
- `utm_source` / `utm_medium` / `utm_campaign` preserved alongside, unmodified.
- **No ref in → no stray `?ref=`** (CTAs stay clean absolute app URLs).
- The language switch carries the ref too, so attribution survives `/ ↔ /ar`.
- Plain-link guarantee: the CTAs are absolute app hrefs in source — they work
  with **no JS**; the pass-through is progressive enhancement (`ref.ts`, ~0.7 KB).

App URL is env-configurable (`VITE_APP_URL`; `withAppUrl` swaps the origin). **10/10 green.**

## Arabic placeholders awaiting a native copywriter

`/ar` ships the RTL layout live (dir=rtl + logical properties throughout; IBM
Plex Sans Arabic) but **no machine-translated copy**. Each of the 12 sections
carries a `TRANSLATION NEEDED` marker and its English source (pinned LTR/lang=en).
Still to be written natively:
- **All 12 section bodies** — the hero headline especially is the one line worth
  paying a native copywriter for.
- The Arabic `<meta name="description">` (English placeholder in `ar/index.html`,
  commented `TRANSLATION NEEDED`).
- The `<title>` is a first Arabic pass; confirm with the copywriter.

A live RTL + bidi **sample** receipt is included (layout only, clearly not final
copy): Latin brand terms and numbers (`Tovira`, `AED 299`) sit correctly in the
Arabic run, and the mono stamp stays LTR/Latin (§3 bidi rule). 7/7 RTL tests green.

## Meta / a11y

- Title + description from the copy doc; canonical + `hreflang` alternates
  (en/ar/x-default); OpenGraph + `summary_large_image` Twitter cards.
- **OG image:** `apps/site/public/og.svg` — the Book Scan frame in the Vault
  theme, wordmark only, no claims text. *Follow-up:* rasterize to `og.png` at
  deploy for maximal scraper compatibility (some scrapers skip SVG); one
  headless-screenshot step. Meta currently points at `og.svg`.
- One `<h1>` (the hero); `header`/`main`/`footer`/`nav` landmarks; every section
  labelled; `role="img"` on the hero phone carries descriptive alt; visible
  **brass** `:focus-visible` ring. 7/7 a11y tests green.

## Performance profile (Lighthouse pending a browser)

A headless Lighthouse/visual pass was **not run** — no browser binary is
provisioned in this environment (Playwright's chromium isn't installed). Static
profile of the shipped build:
- **No runtime framework**, no analytics bundle. JS is a single ~0.7 KB module
  (the referral enhancer) that isn't required for the page or the CTAs to work.
- CSS ~11 KB (gzip ~3 KB), inlined-linked; tokens + primitives + layout.
- Fonts are **self-hosted @fontsource subsets** (the same slices as the app),
  `unicode-range`-gated so only rendered ranges download. No CDN, no web-font JS.
- Static HTML, cached at CloudFront edge (PriceClass_100). First paint on 4G
  should be fast; **verify with Lighthouse on a provisioned browser** before launch.

## Terraform additions (authored, NOT applied)

`infra/terraform/marketing.tf` — a **separate** private S3 bucket + CloudFront
distribution for the apex + www, mirroring the app's frontend pattern and cost
discipline (private bucket + OAC, `PriceClass_100`, managed CachingOptimized
policy, no NAT). `app.tovira.com` stays on the existing `frontend` distribution,
untouched. A `cloudfront-js-2.0` viewer-request function appends `index.html` for
directory paths so `/ar` resolves on the S3 REST origin.
- New vars: `marketing_domain`, `marketing_acm_certificate_arn` (us-east-1) —
  both default `""` (default CloudFront cert, no aliases) until the domain is
  ready; set them to serve the real apex + www.
- New outputs: `marketing_bucket`, `marketing_url`.
- The `terraform` binary isn't installed here, so this wasn't `validate`-run
  locally; it's authored to match the existing (validate-clean) style. Run
  `terraform validate` at the deploy, alongside the rest of the infra.

## CI

`.github/workflows/ci.yml` (new — the repo had no CI): on push to `main` + PRs,
runs `typecheck`, `lint`, `test`, then builds **both** `apps/web` and `apps/site`
(`build:site`) side by side. A broken build in either fails CI, but they still
deploy independently.

## Deploy sequence (for the deploy batch)

1. `terraform apply` including `marketing.tf` (with the domain + us-east-1 ACM
   cert once DNS is ready).
2. `npm run build:site` → `aws s3 sync apps/site/dist s3://<marketing_bucket>` →
   invalidate the marketing CloudFront.
3. Rasterize `og.svg` → `og.png`, sync, point the OG meta at the PNG.
4. Hand `/ar`'s English sources to a native Arabic copywriter; replace the
   TRANSLATION-NEEDED placeholders; redeploy.
5. Run Lighthouse on the live URL; confirm the 4G first-paint budget.
