// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAME_PAGES, fileOf } from './game-pages.js';
import { cardHtml, initialState, start, tap, next, replay, view } from './game.js';
import { GAMES } from './landing-data.js';

/**
 * [P89 · owner, Prompt 86] The brand guard. Public pages are the Marker look (plan/brand.md): it fails if a public page
 * uses the old colours (#171412, #E8643A), the old fonts (Fraunces, Inter, JetBrains Mono), or the highlight yellow
 * (#FFE45C) on a button or a page background (yellow is the marker only: the caught message, a headline's key words, the
 * logo bar). Also: text contrast is at least 4.5:1 for every text colour on the background it sits on, and every control
 * is reachable by keyboard (a link with an href, a button or a summary; nothing with tabindex -1, no click-only divs).
 * Public pages: the landing, the seven game pages, Privacy and Terms (their CSS: site.css with the Marker token block),
 * and the app's public screens (the Marker token block and the auth screens' overrides).
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const PAGES = ['apps/web/index.html', ...GAME_PAGES.map((p) => `apps/web/${fileOf(p)}`), 'apps/web/privacy/index.html', 'apps/web/terms/index.html'];
const CSS = ['apps/web/src/marketing/site.css', 'apps/web/src/styles/geist.css', 'apps/web/src/auth/auth.css'];
const OLD_COLOURS = /#171412|#E8643A/i;
const OLD_FONTS = /Fraunces|\bInter\b|JetBrains Mono/;

/** The Marker token block in packages/brand/tokens.css (the public screens' theme). */
const tokens = read('packages/brand/tokens.css');
const markerBlock = tokens.slice(tokens.indexOf(":root[data-theme='marker'] {"));
const markerVars = Object.fromEntries([...markerBlock.slice(0, markerBlock.indexOf('}')).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));

/** Every page's CSS and markup, without comments (a comment may name an old colour to say it is gone). */
const strip = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
/** The game as it can render on a game page: every screen of every industry. */
const gameScreens = (): string => {
  const out: string[] = [cardHtml(initialState())];
  GAMES.forEach((_g, gi) => {
    let s = start(initialState(), gi);
    out.push(cardHtml(s));
    for (let r = 0; r < 5; r++) { const c = GAMES[gi]!.chats[r]!; for (let i = 0; i < c.length; i++) s = tap(s, i); out.push(cardHtml(s)); s = next(s); }
    out.push(cardHtml(s), cardHtml(replay(s)));
  });
  return out.join('\n');
};

describe('[P89] brand guard: no old colours or fonts on a public page', () => {
  it.each(PAGES)('%s', (p) => {
    const src = strip(read(p));
    expect(src.match(OLD_COLOURS)?.[0] ?? null, p).toBeNull();
    expect(src.match(OLD_FONTS)?.[0] ?? null, p).toBeNull();
  });
  it.each(CSS)('%s', (p) => {
    const src = strip(read(p));
    expect(src.match(OLD_COLOURS)?.[0] ?? null, p).toBeNull();
    expect(src.match(OLD_FONTS)?.[0] ?? null, p).toBeNull();
  });
  it('the game, on every screen it can show', () => {
    const all = gameScreens();
    expect(all.match(OLD_COLOURS)?.[0] ?? null).toBeNull();
    expect(all.match(OLD_FONTS)?.[0] ?? null).toBeNull();
  });
  it('the Marker theme (the app\'s public screens) uses no old colour and one typeface, Geist', () => {
    expect(markerBlock.slice(0, markerBlock.indexOf('}')).match(OLD_COLOURS)).toBeNull();
    for (const f of ['--font-display', '--font-sans', '--font-mono']) {
      expect(markerVars[f], f).toMatch(/^Geist,/);
      expect(markerVars[f], f).not.toMatch(OLD_FONTS);
    }
  });
  it('Privacy and Terms pin the Marker theme, and load Geist (never the old font files)', () => {
    for (const p of ['apps/web/privacy/index.html', 'apps/web/terms/index.html']) expect(read(p)).toContain('<html lang="en" data-theme="marker">');
    const site = read('apps/web/src/marketing/site.css');
    expect(site).toContain("@import '../styles/geist.css';");
    expect(site).not.toMatch(/brand\/fonts\.css|landing-fonts|fraunces|site-fonts/);
  });
  it('Geist is self-hosted with font-display: swap and a metric-matched fallback', () => {
    const g = read('apps/web/src/styles/geist.css');
    expect(g).toMatch(/font-family: Geist;[^}]*font-display: swap;[^}]*src: url\('\.\.\/marketing\/fonts\/geist-latin-wght-normal\.woff2'\)/);
    expect(g).toMatch(/font-family: 'Geist Fallback'; src: local\('Arial'\); size-adjust/);
    expect(read('apps/web/src/marketing/fonts/OFL-Geist.txt')).toMatch(/SIL Open Font License/);
  });
});

describe('[P89] brand guard: yellow is the marker, never a button or a page background', () => {
  /** Elements whose own background is the yellow, in a document (inline styles and the page's own CSS). */
  const yellowFills = (html: string): string[] => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const css = [...doc.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
    // var(--hl) is the yellow in the landing's CSS
    const isYellow = (v: string) => /#FFE45C|var\(--hl\)/i.test(v);
    const out: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decl = m[2]!;
      const bg = /background(?:-color)?\s*:\s*([^;]+)/.exec(decl)?.[1] ?? '';
      if (!isYellow(bg)) continue;
      // a gradient that only underlines (transparent to 55%+, then yellow) is the marker stroke under key words
      if (/linear-gradient\(transparent\s+5\d%/.test(bg)) continue;
      out.push(m[1]!.trim());
    }
    for (const el of doc.querySelectorAll('[style]')) {
      const bg = /background(?:-color)?\s*:\s*([^;]+)/.exec(el.getAttribute('style')!)?.[1] ?? '';
      if (isYellow(bg) && !/linear-gradient\(transparent\s+5\d%/.test(bg)) out.push(`<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}">`);
    }
    return out;
  };
  it('the landing: yellow fills only the marker stroke on the caught message (the key words and the brief are underlines)', () => {
    expect(yellowFills(read('apps/web/index.html'))).toEqual(['.big .stroke']);
  });
  it('the game pages: yellow fills only a caught message (and the logo bar in the SVG)', () => {
    for (const p of GAME_PAGES) expect(yellowFills(read(`apps/web/${fileOf(p)}`)), p.route).toEqual([]);
    const doc = new DOMParser().parseFromString(`<body>${gameScreens()}</body>`, 'text/html');
    for (const el of doc.querySelectorAll('[style]')) {
      if (!/background:\s*#FFE45C/i.test(el.getAttribute('style')!)) continue;
      expect(el.tagName, el.outerHTML.slice(0, 80)).toBe('BUTTON');
      expect(el.getAttribute('aria-pressed'), 'only a caught message').toBe('true');
      expect(el.classList.contains('tv-msg')).toBe(true);
    }
  });
  it('NEGATIVE: no button, pill, CTA or page background is yellow, anywhere public', () => {
    for (const p of PAGES) {
      const doc = new DOMParser().parseFromString(read(p), 'text/html');
      for (const el of doc.querySelectorAll('button, a.pill, a.tv-cta, a.t2-cta, [data-cta], body, html, main, section')) {
        expect(el.getAttribute('style') ?? '', `${p} ${el.tagName}`).not.toMatch(/#FFE45C|var\(--hl\)/i);
      }
      const css = strip([...doc.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n'));
      for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (/(^|,)\s*(html|body|main|section|\.pill|\.t2-cta|\.tv-btn|\.tv-cta|button|\.g-card|\.t2-card|\.t2-sec)\b/.test(m[1]!)) expect(m[2], `${p} ${m[1]}`).not.toMatch(/background[^;]*(#FFE45C|var\(--hl\))/i);
      }
    }
    for (const c of CSS) expect(strip(read(c)), c).not.toMatch(/#FFE45C/i);
    expect(markerVars['--brass'], 'the public screens\' accent (buttons) is ink, never the yellow').toBe('#0A0A0A');
  });
});

// WCAG 2.x relative luminance contrast
const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe('[P89] contrast: every text colour on its background is at least 4.5:1', () => {
  it.each([
    ['ink on the page', '#0A0A0A', '#FAFAFA'], ['ink on cards', '#0A0A0A', '#FFFFFF'], ['ink on the sunk band', '#0A0A0A', '#F2F2F2'],
    ['soft text on the page', '#5A5A5F', '#FAFAFA'], ['soft text on cards', '#5A5A5F', '#FFFFFF'], ['soft text on the privacy band', '#5A5A5F', '#F2F2F2'],
    ['muted labels on the page', '#6B6B70', '#FAFAFA'], ['muted labels on cards', '#6B6B70', '#FFFFFF'],
    ['white on an ink button', '#FFFFFF', '#0A0A0A'], ['the caught card label', '#B4B4BB', '#0A0A0A'], ['near-white on ink', '#FAFAFA', '#0A0A0A'],
    ['ink on the marker yellow (a caught message)', '#0A0A0A', '#FFE45C'], ['ink on the scene\'s message bubble', '#0A0A0A', '#F0F0F0'],
    ['game: ink on a message', '#0A0A0A', '#F2F2F2'], ['game: soft text on a finished message', '#5A5A5F', '#FFFFFF'], ['game: muted counter', '#6B6B70', '#FFFFFF'],
  ])('%s', (_n, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('the Marker theme\'s text tokens on its surfaces (the app\'s public screens)', () => {
    for (const fg of ['--text-primary', '--text-secondary', '--text-tertiary']) for (const bg of ['--surface-base', '--surface-raised', '--surface-elevated']) {
      expect(ratio(markerVars[fg]!, markerVars[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(markerVars['--brass-ink']!, markerVars['--brass']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(markerVars['--claret']!, markerVars['--surface-raised']!), 'errors').toBeGreaterThanOrEqual(4.5);
    expect(ratio(markerVars['--hairline-control']!, markerVars['--surface-raised']!), 'a field\'s edge (3:1 for a control)').toBeGreaterThanOrEqual(3);
  });
  it('every colour the landing and game pages put on text is one of the checked ones', () => {
    const checked = new Set(['#0A0A0A', '#5A5A5F', '#6B6B70', '#FFFFFF', '#FAFAFA', '#B4B4BB', '#FFF', 'CURRENTCOLOR']);
    for (const p of ['apps/web/index.html', ...GAME_PAGES.map((g) => `apps/web/${fileOf(g)}`)]) {
      // the scene's decorative chat bubbles (.msg, aria-hidden) are checked below, not as the page's text
      const src = strip(read(p)).replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/\.msg\{[^}]*\}/g, '');
      for (const m of src.matchAll(/(?<![-\w])color\s*:\s*(#[0-9a-f]{3,6}|currentColor)/gi)) expect(checked.has(m[1]!.toUpperCase()), `${p}: ${m[0]}`).toBe(true);
    }
    // the scene's decorative chat columns (#77777D) are aria-hidden and never the page's text
    expect(read('apps/web/index.html')).toMatch(/\.msg\{[^}]*color:#77777D/);
    expect(read('apps/web/index.html')).toContain('<div class="cols" aria-hidden="true">');
    const v = view(start(initialState(), 0));
    for (const m of v.msgs) expect(m.style).toMatch(/color:#0A0A0A|color:#5A5A5F/);
  });
});

describe('[P89] keyboard: every control is reachable', () => {
  it.each(PAGES)('%s: every control is a real link, button or summary; nothing is taken out of the tab order', (p) => {
    const doc = new DOMParser().parseFromString(read(p), 'text/html');
    expect(doc.querySelectorAll('[tabindex="-1"], [onclick], div[role="button"], span[role="button"]'), p).toHaveLength(0);
    for (const a of doc.querySelectorAll('a')) expect(a.hasAttribute('href'), `${p}: ${a.outerHTML.slice(0, 60)}`).toBe(true);
    for (const b of doc.querySelectorAll('button')) expect(b.getAttribute('type'), p).toBe('button');
  });
  it('the game: every message, Next, Play again and Try another industry are buttons or links', () => {
    const doc = new DOMParser().parseFromString(`<body>${gameScreens()}</body>`, 'text/html');
    for (const el of doc.querySelectorAll('[data-i], [data-act]')) expect(['BUTTON', 'A'], el.outerHTML.slice(0, 60)).toContain(el.tagName);
    for (const a of doc.querySelectorAll('a')) expect(a.hasAttribute('href')).toBe(true);
  });
});
