/**
 * [P89 · owner, Prompt 86] The Marker brand's shared public-page pieces (plan/brand.md, plan/brand-tokens.json): the
 * colour tokens, the logo, the header and the footer, as HTML strings, so the landing, the seven game pages and the
 * generator that writes them (scripts/gen-game-pages.ts) draw them the same way. No libraries, no app code.
 */
export const TOKENS = {
  ground: '#FAFAFA', surface: '#FFFFFF', surfaceSunk: '#F2F2F2', line: '#E6E6E6', lineStrong: '#CFCFCF',
  ink: '#0A0A0A', inkSoft: '#5A5A5F', muted: '#6B6B70', onInk: '#FFFFFF', onInkSoft: '#B4B4BB', highlight: '#FFE45C',
} as const;

export const SANS = "Geist, 'Geist Fallback', system-ui, sans-serif";

/**
 * The logo disc (plan/brand.md "Logo"): a black disc holding a T, a white stem under a level yellow bar that floats just
 * above it. Drawn on a 30-unit grid (the reference's 30px disc). The disc alone is the favicon and the app icon.
 */
export function discSvg(size = 30, label = false): string {
  const a11y = label ? 'role="img" aria-label="Tovira"' : 'aria-hidden="true" focusable="false"';
  return `<svg class="disc" width="${size}" height="${size}" viewBox="0 0 30 30" ${a11y}>`
    + `<circle cx="15" cy="15" r="15" fill="${TOKENS.ink}"/>`
    + `<rect x="6" y="7" width="18" height="6" rx="1.5" fill="${TOKENS.highlight}"/>`
    + `<rect x="12" y="15" width="6" height="9" rx="1.5" fill="${TOKENS.onInk}"/>`
    + `</svg>`;
}

/** The logo: the disc, then "Tovira" in Geist 600, as a link. */
export const logoHtml = (href: string): string => `<a class="logo" href="${href}">${discSvg()}Tovira</a>`;

export interface NavLink { href: string; label: string }

/** The header bar: the logo, the nav links (hidden on phones), Log in and the Start free pill. */
export function headerHtml(o: { logoHref: string; links: NavLink[]; place?: string }): string {
  return `<header class="bar">\n  ${logoHtml(o.logoHref)}\n`
    + `  <nav aria-label="Main" class="barnav">\n    `
    + o.links.map((l) => `<a class="navlink" href="${l.href}">${l.label}</a>`).join('')
    + `<a class="login" href="/app">Log in</a>\n`
    + `    <a class="pill pill-sm" data-cta data-place="${o.place ?? 'header'}" href="/request-access">Start free</a>\n`
    + `  </nav>\n</header>`;
}

/** The footer: the company line with the contact address, and the legal links. */
export function footerHtml(): string {
  return `<footer class="foot">\n<div class="foot-in">\n`
    + `<span>Tovira · Prospera Technologies FZ-LLC · <a href="mailto:hello@tovira.io">hello@tovira.io</a></span>\n`
    + `<span class="foot-links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></span>\n`
    + `</div>\n</footer>`;
}

/** The CSS the header, logo, pills and footer need (shared by the landing and the game pages). */
export const CHROME_CSS = `
.bar{position:fixed;top:0;left:0;right:0;z-index:20;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 20px;background:rgba(250,250,250,.86);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.logo{display:flex;align-items:center;gap:10px;font-weight:600;font-size:22px;letter-spacing:-.03em;text-decoration:none;color:var(--ink)}
.logo .disc{flex:0 0 auto}
.barnav{display:flex;align-items:center;gap:20px;font-size:15px}
.navlink,.login{color:var(--soft);text-decoration:none}
.pill{display:inline-block;background:var(--ink);color:#fff;text-decoration:none;font-weight:600;font-size:16px;padding:13px 24px;border-radius:999px;min-height:44px;line-height:18px}
.pill-sm{font-size:14px;padding:13px 18px}
.pill:focus-visible,.navlink:focus-visible,.login:focus-visible,.logo:focus-visible,.foot a:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:4px}
.pill:focus-visible{border-radius:999px}
.foot{border-top:1px solid var(--line)}
.foot-in{max-width:1120px;margin:0 auto;padding:24px 20px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;font-size:14px;color:var(--muted)}
.foot a{color:var(--muted)}
.foot-links{display:flex;gap:18px}
@media (max-width:640px){.navlink{display:none}.barnav{gap:14px}}
`;
