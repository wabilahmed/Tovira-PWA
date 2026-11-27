/**
 * [P89 · owner, Prompt 86] The game's own pages: /game (pick an industry) and one page per industry that starts that
 * industry's game. Each is a real static page with its H1, one-line description, title, meta description, canonical
 * and share tags in the HTML itself (not injected by script), so it can rank in search. scripts/gen-game-pages.ts writes
 * them to apps/web/game/…/index.html; game-pages.test.ts fails if a written page drifts from this. The game's rules,
 * content and scoring are game.ts and landing-data.ts, unchanged.
 */
import { cardHtml, esc, initialState, start, SLUGS, industryHref } from './game.js';
import { CHROME_CSS, footerHtml, headerHtml } from './marker.js';

export interface GamePage {
  route: string; gi: number; h1: string; sub: string; title: string; description: string; og: string;
}

const NAMES = ['Property', 'Insurance', 'Wealth', 'B2B', 'Luxury', 'Recruitment'] as const;
const DESCRIPTIONS = [
  'Five chats with home buyers. Spot the needs and deadlines hidden in the small talk before you send another listing.',
  'Five chats with people choosing cover. Find the travel, family and timing details that make a policy fit.',
  'Five chats with private clients. Catch the dates and plans that change what they need from their money.',
  'Five chats with business buyers. Find the deadlines, worries and must-haves buried between the logistics.',
  'Five chats with collectors and gift buyers. Notice the tastes and occasions that turn a browse into a sale.',
  'Five chats with candidates. Pick out what would really make them move, and what would make them say no.',
] as const;

export const GAME_H1 = 'Can you spot the detail that wins the deal?';
export const GAME_SUB = 'Five client chats. Tap the details that matter. One wrong tap ends the chat.';
export const CLOSING = 'Tovira catches every one of them for you.';
export const ORIGIN = 'https://tovira.io';

export const GAME_PAGES: GamePage[] = [
  { route: '/game', gi: -1, h1: GAME_H1, sub: GAME_SUB, title: 'Can you spot the detail that wins the deal? A 2-minute sales test | Tovira', description: GAME_SUB, og: 'og-game.png' },
  ...SLUGS.map((slug, gi): GamePage => ({
    route: industryHref(gi), gi,
    h1: `${NAMES[gi]} sales test: can you spot the detail that wins the deal?`,
    sub: DESCRIPTIONS[gi]!,
    title: `${NAMES[gi]} sales test: spot the detail that wins the deal | Tovira`,
    description: DESCRIPTIONS[gi]!,
    og: `og-game-${slug}.png`,
  })),
];

/** Where the generator writes a page (relative to apps/web). */
export const fileOf = (p: GamePage): string => `${p.route.slice(1)}/index.html`;

const PAGE_CSS = `
:root{--ground:#FAFAFA;--ink:#0A0A0A;--soft:#5A5A5F;--muted:#6B6B70;--line:#E6E6E6;--hl:#FFE45C;color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0;background:var(--ground);color:var(--ink);font-family:Geist,'Geist Fallback',system-ui,sans-serif}
body{overflow-x:clip}
a{color:inherit}
${CHROME_CSS.trim()}
.g-main{max-width:640px;margin:0 auto;padding:104px 20px 56px;display:flex;flex-direction:column;gap:28px}
.g-h1{margin:0;font-weight:600;font-size:clamp(32px,5vw,48px);line-height:1.06;letter-spacing:-.04em;text-wrap:balance}
.g-sub{margin:0;font-size:clamp(17px,1.8vw,19px);line-height:1.5;color:var(--soft)}
.g-card{background:#FFFFFF;border:1px solid var(--line);border-radius:20px;padding:clamp(14px,2.4vw,20px);display:flex;flex-direction:column;gap:14px;box-shadow:0 30px 70px rgba(0,0,0,.06);scroll-margin-top:84px}
.g-close{display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center;padding:24px 0 8px;border-top:1px solid var(--line)}
.g-close p{margin:0;font-weight:600;font-size:clamp(24px,3.4vw,32px);letter-spacing:-.03em;line-height:1.1}
.g-more{display:flex;flex-direction:column;gap:10px}
.g-more h2{margin:0;font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.g-more ul{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:8px}
.g-more a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid #CFCFCF;border-radius:999px;text-decoration:none;font-weight:500;font-size:15px}
.tv-msg{font:inherit;text-align:left;cursor:pointer;transition:background .2s,border-color .2s,transform .15s}
.tv-msg:not(:disabled):hover{border-color:#0A0A0A}
.tv-msg:disabled{cursor:default}
.tv-btn{cursor:pointer;font:inherit}
.tv-pick:hover{border-color:#0A0A0A}
.tv-msg:focus-visible,.tv-btn:focus-visible,.tv-cta:focus-visible,.g-more a:focus-visible{outline:2px solid #0A0A0A;outline-offset:3px}
.tv-rule{font-size:17px}
.tv-pop{animation:tvPop .45s cubic-bezier(.2,1.4,.4,1) both}
@keyframes tvPop{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:none}}
.tv-shake{animation:tvShake .35s ease-in-out}
@keyframes tvShake{0%,100%{transform:none}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
@media (prefers-reduced-motion:reduce){.tv-pop,.tv-shake{animation:none !important}.tv-msg{transition:none}}
`;

const head = (p: GamePage): string => {
  const url = ORIGIN + p.route;
  const img = `${ORIGIN}/${p.og}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#FAFAFA" />
    <meta name="color-scheme" content="light" />
    <title>${esc(p.title)}</title>
    <meta name="description" content="${esc(p.description)}" />
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(p.h1)}" />
    <meta property="og:description" content="${esc(p.description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${img}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:alt" content="${esc(`Tovira: ${p.h1}`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(p.h1)}" />
    <meta name="twitter:description" content="${esc(p.description)}" />
    <meta name="twitter:image" content="${img}" />
    <meta name="twitter:image:alt" content="${esc(`Tovira: ${p.h1}`)}" />
    <link rel="preload" href="/src/marketing/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/src/styles/geist.css" />
    <!-- [P89 · owner, Prompt 86] Written by scripts/gen-game-pages.ts from src/marketing/game-pages.ts. Do not edit by hand. -->
    <style>${PAGE_CSS}</style>
    <script type="module" src="/src/marketing/game-main.ts"></script>
  </head>`;
};

/** The links to the other game pages (each industry page links /game and the other five; /game's card links all six). */
function moreHtml(p: GamePage): string {
  if (p.gi < 0) return '';
  const links = [`<li><a href="/game">All industries</a></li>`]
    .concat(GAME_PAGES.filter((o) => o.gi >= 0 && o.gi !== p.gi).map((o) => `<li><a href="${o.route}">${NAMES[o.gi]}</a></li>`));
  return `\n<nav class="g-more" aria-labelledby="more-h">\n<h2 id="more-h">Try another industry</h2>\n<ul>${links.join('')}</ul>\n</nav>`;
}

/** The whole page. */
export function gamePageHtml(p: GamePage): string {
  const state = p.gi < 0 ? initialState() : start(initialState(), p.gi);
  return `${head(p)}
  <body>
${headerHtml({ logoHref: '/', links: [{ href: '/game', label: 'The game' }, { href: '/#privacy', label: 'Privacy' }, { href: '/#pricing', label: 'Pricing' }] })}
<main class="g-main">
<section aria-labelledby="game-h" style="display: flex; flex-direction: column; gap: 14px">
<h1 class="g-h1" id="game-h">${esc(p.h1)}</h1>
<p class="g-sub">${esc(p.sub)}</p>
</section>
<section id="game" aria-label="The game">
<div class="g-card" data-game data-gi="${p.gi}">${cardHtml(state)}</div>
</section>
<section class="g-close" aria-label="Start free">
<p>${CLOSING}</p>
<a class="pill" data-cta data-place="game_close" href="/request-access">Start free</a>
</section>${moreHtml(p)}
</main>
${footerHtml()}
  </body>
</html>
`;
}
