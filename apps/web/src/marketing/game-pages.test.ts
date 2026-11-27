// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAME_PAGES, CLOSING, fileOf, gamePageHtml } from './game-pages.js';
import { cardHtml, initialState, start } from './game.js';

/**
 * [P89 · owner, Prompt 86] The game moves off the landing to its own pages so they can rank in search: /game (choose
 * your industry) and six industry pages that each start that industry's game. Each page's H1 and one-line description
 * are in the HTML itself (not injected by script), with its own title, meta description, canonical (the clean address
 * from day one) and share tags; all seven are in the sitemap; /game links the six and each links /game; under the game,
 * "Tovira catches every one of them for you." and Start free. The old /#game links go to /game.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ROUTES = ['/game', '/game/property', '/game/insurance', '/game/wealth', '/game/b2b', '/game/luxury', '/game/recruitment'];
const NAMES = ['Property', 'Insurance', 'Wealth', 'B2B', 'Luxury', 'Recruitment'];
const pages = GAME_PAGES.map((p) => ({ p, html: read(`apps/web/${fileOf(p)}`), d: new DOMParser().parseFromString(read(`apps/web/${fileOf(p)}`), 'text/html') }));
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const meta = (d: Document, sel: string) => d.querySelector(sel)?.getAttribute('content') ?? null;

describe('[P89] the seven game pages exist, written from game-pages.ts', () => {
  it('the routes are /game and the six industries, each a static index.html', () => {
    expect(GAME_PAGES.map((p) => p.route)).toEqual(ROUTES);
    for (const r of ROUTES) expect(existsSync(resolve(process.cwd(), `apps/web${r}/index.html`)), r).toBe(true);
  });
  it('each written page is exactly what the generator makes (regenerate: npx tsx apps/web/scripts/gen-game-pages.ts)', () => {
    for (const { p, html } of pages) expect(html, p.route).toBe(gamePageHtml(p));
  });
  it('vite builds all seven as pages', () => {
    const vite = read('apps/web/vite.config.ts');
    expect(vite).toContain("game: html('./game/index.html')");
    expect(vite).toContain("export const GAME_SLUGS = ['property', 'insurance', 'wealth', 'b2b', 'luxury', 'recruitment'];");
  });
});

describe('[P89] each page\'s H1 and description are in the HTML', () => {
  it('/game: "Can you spot the detail that wins the deal?" and the rules line', () => {
    const d = pages[0]!.d;
    expect(text(d.querySelector('h1'))).toBe('Can you spot the detail that wins the deal?');
    expect(text(d.querySelector('h1 + p'))).toBe('Five client chats. Tap the details that matter. One wrong tap ends the chat.');
  });
  it('each industry: "<Industry> sales test: can you spot the detail that wins the deal?" and its own line', () => {
    pages.slice(1).forEach(({ d }, i) => {
      expect(text(d.querySelector('h1'))).toBe(`${NAMES[i]} sales test: can you spot the detail that wins the deal?`);
      expect(text(d.querySelector('h1 + p')).length).toBeGreaterThan(40);
    });
    const subs = pages.map(({ d }) => text(d.querySelector('h1 + p')));
    expect(new Set(subs).size).toBe(7); // all distinct
  });
  it('exactly one h1 per page, in the raw HTML (no script writes it)', () => {
    for (const { p, html, d } of pages) {
      expect(d.querySelectorAll('h1'), p.route).toHaveLength(1);
      expect(html, p.route).toContain(`<h1 class="g-h1" id="game-h">${p.h1}</h1>`);
    }
    expect(read('apps/web/src/marketing/game-main.ts')).not.toMatch(/h1|innerText|textContent\s*=/);
  });
});

describe('[P89] title, description, canonical and share tags per page', () => {
  it('own title and meta description; canonical, og:url on the clean address; share image per page', () => {
    const seen = new Set<string>();
    for (const { p, d } of pages) {
      const url = `https://tovira.io${p.route}`;
      expect(d.title, p.route).toBe(p.title);
      expect(meta(d, 'meta[name="description"]'), p.route).toBe(p.description);
      expect(d.querySelector('link[rel="canonical"]')?.getAttribute('href'), p.route).toBe(url);
      expect(meta(d, 'meta[property="og:url"]'), p.route).toBe(url);
      expect(meta(d, 'meta[property="og:title"]'), p.route).toBe(p.h1);
      expect(meta(d, 'meta[property="og:description"]'), p.route).toBe(p.description);
      expect(meta(d, 'meta[property="og:image"]'), p.route).toBe(`https://tovira.io/${p.og}`);
      expect(meta(d, 'meta[name="twitter:image"]'), p.route).toBe(`https://tovira.io/${p.og}`);
      expect(meta(d, 'meta[name="twitter:card"]'), p.route).toBe('summary_large_image');
      expect(meta(d, 'meta[property="og:image:alt"]'), p.route).toContain(p.h1);
      seen.add(d.title);
      const png = readFileSync(resolve(process.cwd(), 'apps/web/public', p.og));
      expect([png.subarray(1, 4).toString(), png.readUInt32BE(16), png.readUInt32BE(20)], p.og).toEqual(['PNG', 1200, 630]);
    }
    expect(seen.size).toBe(7);
  });
  it('NEGATIVE: no canonical or share tag uses /index.html or a host we do not own', () => {
    for (const { html } of pages) {
      expect(html).not.toMatch(/https:\/\/tovira\.io\/game[^"]*index\.html/);
      expect(html).not.toMatch(new RegExp(`staging\\.tovira\\.io|cloudfront\\.net|${['tovira', 'com'].join('\\.')}`, 'i'));
    }
  });
});

describe('[P89] links between the pages, the game, and the close', () => {
  it('/game links the six industry pages (the pick screen); each industry page links /game and the other five', () => {
    const pick = [...pages[0]!.d.querySelectorAll('[data-game] a')].map((a) => a.getAttribute('href'));
    expect(pick).toEqual(ROUTES.slice(1));
    pages.slice(1).forEach(({ p, d }) => {
      const more = [...d.querySelectorAll('nav.g-more a')].map((a) => a.getAttribute('href'));
      expect(more[0], p.route).toBe('/game');
      expect(new Set(more), p.route).toEqual(new Set(ROUTES.filter((r) => r !== p.route)));
    });
  });
  it('the card is the game\'s own first screen: the pick on /game, the industry\'s first chat on its page', () => {
    for (const { p, d } of pages) {
      const card = d.querySelector('[data-game]')!;
      expect(card.getAttribute('data-gi'), p.route).toBe(String(p.gi));
      expect(card.innerHTML, p.route).toBe(new DOMParser().parseFromString(`<div>${cardHtml(p.gi < 0 ? initialState() : start(initialState(), p.gi))}</div>`, 'text/html').body.firstElementChild!.innerHTML);
    }
  });
  it('under the game on every page: the closing line and Start free (a counted CTA to the request form)', () => {
    for (const { p, d } of pages) {
      const close = d.querySelector('.g-close')!;
      expect(text(close.querySelector('p')), p.route).toBe(CLOSING);
      expect(CLOSING).toBe('Tovira catches every one of them for you.');
      const a = close.querySelector('a')!;
      expect([text(a), a.getAttribute('href'), a.getAttribute('data-place'), a.hasAttribute('data-cta')], p.route).toEqual(['Start free', '/request-access', 'game_close', true]);
      expect(d.querySelector('[data-game]')!.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING, p.route).toBeTruthy();
    }
  });
  it('every page has the Marker header and footer, and the legal links', () => {
    for (const { p, d } of pages) {
      expect(text(d.querySelector('body > header .logo')), p.route).toBe('Tovira');
      expect([...d.querySelectorAll('footer a')].map((a) => a.getAttribute('href')), p.route).toEqual(['mailto:hello@tovira.io', '/privacy', '/terms']);
    }
  });
});

describe('[P89] search: sitemap and robots', () => {
  const sitemap = read('apps/web/public/sitemap.xml');
  it('the sitemap lists the landing, the seven game pages and the legal pages, on their clean addresses', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const r of ROUTES) expect(locs, r).toContain(`https://tovira.io${r}`);
    expect(locs).toContain('https://tovira.io/');
    for (const l of locs) expect(l).not.toMatch(/index\.html|\/$(?<!tovira\.io\/)/);
  });
  it('robots.txt points at the sitemap and still keeps the app out', () => {
    const robots = read('apps/web/public/robots.txt');
    expect(robots).toContain('Sitemap: https://tovira.io/sitemap.xml');
    expect(robots).toContain('Disallow: /app');
    expect(robots).not.toMatch(/Disallow: \/game/);
  });
});

describe('[P89] routing: the clean addresses reach the pages', () => {
  it('the service worker treats the game pages as marketing pages (network first), never the app shell', () => {
    const sw = read('apps/web/src/pwa/sw.ts');
    const re = new RegExp(/const MARKETING = (\/.*\/);/.exec(sw)![1]!.slice(1, -1));
    for (const r of ROUTES) expect(re.test(r), r).toBe(true);
    expect(re.test('/game/unknown')).toBe(false);
  });
  it('until the CloudFront routing is applied, the app shell sends a clean game address to its page file (and nothing else)', () => {
    const app = read('apps/web/app.html');
    const script = /<script>([\s\S]*?tovira\.theme[\s\S]*?)<\/script>/.exec(app)![1]!;
    const go = (path: string): string | null => {
      let to: string | null = null;
      const loc = { pathname: path, search: '?ref=x', hash: '', replace: (u: string) => { to = u; } };
      new Function('location', 'localStorage', 'document', 'window', script)(loc, { getItem: () => null }, { documentElement: { setAttribute() {}, removeAttribute() {} }, querySelectorAll: () => [] }, { matchMedia: () => ({ matches: false }) });
      return to;
    };
    for (const r of ROUTES) { expect(go(r), r).toBe(`${r}/index.html?ref=x`); expect(go(`${r}/`), r).toBe(`${r}/index.html?ref=x`); }
    for (const other of ['/app', '/request-access', '/game/unknown', '/gamesx', '/']) expect(go(other), other).toBeNull();
  });
  it('the old /#game link goes to /game (before anything paints, and from main.ts)', async () => {
    expect(read('apps/web/index.html')).toContain("<script>if(location.hash==='#game')location.replace('/game'+location.search)</script>");
    const { movedAnchor } = await import('./main.js');
    expect(movedAnchor('#game')).toBe('/game');
    expect(movedAnchor('#pricing')).toBeNull();
  });
});
