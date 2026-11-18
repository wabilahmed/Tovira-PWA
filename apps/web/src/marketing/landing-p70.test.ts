// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FRAGMENTS, fragmentsIn } from './landing-render.js';
import { WORLDS, GAMES, MARQ_A, MARQ_B, WALL_A, WALL_B, WALL_C } from './landing-data.js';
import { mountWorlds, keyTarget } from './worlds.js';

/**
 * [P70 · owner] The landing page rebuilt from the approved design (plan/tovira-landing-reference.dc.html). Reads the
 * REAL shipped landing HTML. Pins the copy the owner named, the page's order, the tabs' accessibility, reduced motion,
 * contrast, and the claims rule (every "Tovira caught" line is one the product was shown to catch).
 */
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const d = new DOMParser().parseFromString(html, 'text/html');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const DESC = 'Tovira analyses your client conversations and voice notes, catches the details a busy rep misses, and puts them in front of you before the meeting that matters.';
const TITLE = 'Tovira: the detail that wins the deal is already in your chats';

describe('[P70] meta and share', () => {
  it('title, description, OG and Twitter text, theme colour', () => {
    expect(d.title).toBe(TITLE);
    for (const sel of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) expect(d.querySelector(sel)?.getAttribute('content'), sel).toBe(DESC);
    for (const sel of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) expect(d.querySelector(sel)?.getAttribute('content'), sel).toBe(TITLE);
    expect(d.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#171412');
  });
});

describe('[P70] the hero', () => {
  // [P76 · owner] the eyebrow is removed (pinned in landing-p76.test.ts); the hero's Play the game is still the second CTA (P76: shown only on mobile)
  it('headline, subhead, CTAs and the price line', () => {
    expect(html).not.toContain('FOR RELATIONSHIP SALES');
    expect(text(d.querySelector('h1'))).toBe('The detail that wins the deal is already in your chats.You just scrolled past it.');
    expect([...d.querySelectorAll('h1 > span')].map(text)).toEqual(['The detail that wins the deal is already in your chats.', 'You just scrolled past it.']);
    expect(text(d.querySelector('h1 + p'))).toBe(DESC);
    const ctas = [...d.querySelectorAll('#top a.tv-cta')].map((a) => [text(a), a.getAttribute('href')]);
    expect(ctas.slice(0, 2)).toEqual([['Try free for 14 days', '/request-access'], ['Play the game', '#game']]);
    expect(html).toContain('Then AED 299 a month. Tovira never connects to your WhatsApp account.');
  });
  it('the game sits in the hero\'s right column, headed "Would you have caught it?" with "A 2-MINUTE TEST" (P71 · owner)', () => {
    const game = d.querySelector('#top #game')!;
    expect(text(game.querySelector('h2'))).toBe('Would you have caught it?');
    expect(text(game)).toContain('A 2-MINUTE TEST');
    expect(game.querySelector('[data-game]')).not.toBeNull();
  });
  it('28 stars (about 1 in 5 gold) and two orbs; the old chat demo is gone', () => {
    const stars = d.querySelectorAll('#top .tv-star');
    expect(stars).toHaveLength(28);
    const gold = [...stars].filter((s) => s.getAttribute('style')!.includes('#F2B84B')).length;
    expect(gold).toBeGreaterThanOrEqual(3);
    expect(gold).toBeLessThanOrEqual(9);
    expect(d.querySelectorAll('#top .tv-orb')).toHaveLength(2);
    expect(d.querySelector('.device, .scan, [data-deal]')).toBeNull();
  });
});

describe('[P70] the sections, in order', () => {
  it('header, hero, marquee, problem, game in the hero, worlds, how, trust, pricing, FAQ, close, footer', () => {
    const headings = [...d.querySelectorAll('h1, h2')].map(text);
    expect(headings).toEqual([
      'The detail that wins the deal is already in your chats.You just scrolled past it.',
      'Would you have caught it?',
      'Your clients tell you how to win them. Once. In passing.',
      'See what Tovira would catch in your chats.',
      'Send it a chat. It finds what you missed.',
      'It shows its work, then puts it to work.', // [P76 · owner] the new heading
      'One plan. Pays for itself with one detail.',
      'Questions',
      'Your next client has already told you something important.',
    ]);
    expect(d.querySelectorAll('h1')).toHaveLength(1);
  });
  it('the header: wordmark, three section links, Log in, and the CTA', () => {
    const nav = d.querySelector('body > header nav')!;
    expect([...nav.querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href')])).toEqual([
      ['Test your eye', '#game'], ['How it works', '#how'], ['Pricing', '#pricing'], ['Log in', '/app'], ['Try free for 14 days', '/request-access'],
    ]);
    expect([...nav.querySelectorAll('.tv-navlink')].map(text)).toEqual(['Test your eye', 'How it works', 'Pricing']);
    expect(style).toMatch(/@media \(max-width: 640px\)\{\.tv-navlink\{display:none\}/);
    expect(d.querySelector('body > header')?.getAttribute('style')).toMatch(/position: sticky/);
    expect(style).toMatch(/overflow-x:clip/); // not hidden: a hidden ancestor would stop the header sticking
  });
  it('the marquee: two rows, 60s and 70s in opposite directions, decorative', () => {
    const rows = d.querySelectorAll('.tv-marq');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.closest('section')!.getAttribute('aria-hidden')).toBe('true');
    expect(style).toContain('.tv-marq{display:flex;width:max-content;animation:tvMarq 60s linear infinite}');
    expect(style).toContain('.tv-marq.rev{animation-direction:reverse;animation-duration:70s}');
    expect([...rows[0]!.querySelectorAll('span')].map(text)).toEqual(MARQ_A.concat(MARQ_A));
    expect([...rows[1]!.querySelectorAll('span')].map(text)).toEqual(MARQ_B.concat(MARQ_B));
  });
  it('the problem wall: three columns rising at 38s, 46s and 42s, tilted back, masked, missed lines glowing', () => {
    const wall = d.querySelector('.tv-wall')!;
    expect(wall.getAttribute('aria-hidden')).toBe('true');
    expect(wall.getAttribute('style')).toMatch(/mask-image: linear-gradient/);
    expect(wall.querySelector(':scope > div')!.getAttribute('style')).toContain('rotateX(14deg)');
    const cols = [...wall.querySelectorAll('.tv-col')];
    expect(cols.map((c) => c.getAttribute('style')!.match(/animation-duration: (\d+s)/)![1])).toEqual(['38s', '46s', '42s']);
    [WALL_A, WALL_B, WALL_C].forEach((lines, i) => {
      expect(cols[i]!.querySelectorAll('.tv-missed')).toHaveLength(lines.filter((l) => l.m).length * 2);
    });
    expect(style).toMatch(/\.tv-wall\{height:360px !important\}/);
  });
});

describe('[P70] Pick your world', () => {
  const tabs = [...d.querySelectorAll('[role="tablist"] [role="tab"]')];
  it('six tab buttons, Property selected by default', () => {
    expect(tabs.map(text)).toEqual(['Property', 'Insurance', 'Wealth', 'B2B accounts', 'Luxury', 'Recruitment']);
    expect(tabs.every((t) => t.tagName === 'BUTTON')).toBe(true);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1', '-1']);
    expect(d.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('world-tab-0');
  });
  it('each tab\'s caught line, and the Recruitment quote exactly as the owner set it', () => {
    expect(WORLDS.map((w) => [w.label, w.caught])).toEqual([
      ['Property', 'Loves the beach. Every weekend, with the kids.'],
      ['Insurance', 'Travels to Europe most months.'],
      ['Wealth', 'Daughter at LSE from September. Wants liquidity.'],
      ['B2B accounts', 'The CFO really decides. Board meets on the 14th.'],
      ['Luxury', 'Anniversary in May. She loved the emerald set.'],
      ['Recruitment', 'Wants hybrid. Three office days at most.'],
    ]);
    const rec = WORLDS[5]!;
    expect(rec.buried).toBe("Honestly, I'd only move for hybrid, three days in the office max");
    expect(html).not.toMatch(/school run|after the baby/i);
    expect(text(d.querySelector('[data-world="caught"]'))).toBe('Loves the beach. Every weekend, with the kids.');
  });
  it('"Your move" is the rep\'s, with the owner\'s line kept exactly', () => {
    expect(text(d.querySelector('[role="tabpanel"]'))).toContain('You decide. Tovira just makes sure you saw it.');
  });
  it('clicking and arrow keys select tabs, aria-selected follows, the panel changes and fades in again', () => {
    document.body.innerHTML = `<div data-worlds role="tablist">${FRAGMENTS.tabs!()}</div><div data-world-panel class="tv-fade">${FRAGMENTS.panel!()}</div>`;
    const list = document.querySelector<HTMLElement>('[data-worlds]')!;
    const panel = document.querySelector<HTMLElement>('[data-world-panel]')!;
    const w = mountWorlds(list, panel);
    const sel = () => [...list.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-selected'));
    list.querySelector<HTMLElement>('#world-tab-5')!.click();
    expect(w.picked()).toBe(5);
    expect(sel()[5]).toBe('true');
    expect(panel.textContent).toContain('Wants hybrid. Three office days at most.');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(w.picked()).toBe(0);
    expect(document.activeElement?.id).toBe('world-tab-0');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(w.picked()).toBe(5);
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(sel()).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
    expect(panel.classList.contains('tv-fade')).toBe(true);
    expect(panel.getAttribute('aria-labelledby')).toBe('world-tab-0');
    expect(keyTarget('End', 0)).toBe(5);
    expect(keyTarget('a', 0)).toBeNull();
  });
});

describe('[P70] how it works, trust, pricing, FAQ, close, footer', () => {
  it('three steps', () => {
    expect([...d.querySelectorAll('#how h3')].map(text)).toEqual(['Give it the conversation', 'Tovira analyses every line', 'It speaks up at the right time']);
    expect(text(d.querySelector('#how'))).toContain('Each morning, who to call and what they care about.');
  });
  // [P76 · owner] "Not connected to your WhatsApp" and "Private by design" are replaced by two features (word for word in
  // landing-p76.test.ts); the hero still says Tovira never connects to your WhatsApp account
  it('four trust points', () => {
    const t = d.querySelector('section[aria-labelledby="trust-h"]')!;
    // [P76 · owner] the section's label is removed too, so there is no label to skip
    expect([...t.querySelectorAll('.tv-rv > div:first-child')].map(text)).toEqual(['Linked to the message', 'Never invents a date', 'A brief before every meeting', 'Every promise, on time']);
  });
  it('prices: AED 299 monthly, AED 2,990 yearly with two months free', () => {
    const plans = [...d.querySelectorAll('#pricing .tv-rv > div')].map((c) => [...c.children].map(text));
    expect(plans).toEqual([['Monthly', 'AED 299', 'per month'], ['Yearly · two months free', 'AED 2,990', 'per year']]);
    expect(text(d.querySelector('#pricing'))).toContain('14 days free. No tiers, no seats. Cancel any time in Settings.');
  });
  // [P76 · owner] the owner's five questions replace the four (answers word for word in landing-p76.test.ts)
  it('the five FAQ questions, as <details>', () => {
    expect([...d.querySelectorAll('details > summary')].map(text)).toEqual(['What does Tovira pick up from a chat?', 'How do I get my chats into Tovira?', 'What does Tovira do with what it finds?', 'Does it work in Arabic, Hindi or Urdu?', 'Why not just ask ChatGPT?']);
  });
  it('the close and the footer', () => {
    expect(text(d.querySelector('#start a.tv-cta'))).toBe('Try free for 14 days');
    expect(text(d.querySelector('footer'))).toBe('Tovira · Prospera Technologies FZ-LLC PrivacyTerms');
  });
  it('NEGATIVE: no floating or sticky button at the bottom of the page', () => {
    expect(d.querySelector('[data-mobile-cta], .mobile-cta')).toBeNull();
    for (const el of d.querySelectorAll('[style]')) {
      const s = el.getAttribute('style')!;
      if (/position:\s*(fixed|sticky)/.test(s)) expect(el.tagName, s).toBe('HEADER');
    }
    expect(style).not.toMatch(/position:\s*fixed/);
  });
});

describe('[P70] motion', () => {
  it('the design\'s keyframes, verbatim', () => {
    for (const k of [
      '@keyframes tvUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}',
      '@keyframes tvTwinkle{0%,100%{opacity:.15;transform:scale(.6)}50%{opacity:1;transform:scale(1)}}',
      '@keyframes tvOrb{from{transform:translate(0,0) scale(1)}to{transform:translate(-60px,40px) scale(1.15)}}',
      '@keyframes tvMarq{from{transform:translateX(0)}to{transform:translateX(-50%)}}',
      '@keyframes tvRise{from{transform:translateY(0)}to{transform:translateY(-50%)}}',
      '@keyframes tvPop{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:none}}',
      '@keyframes tvShake{0%,100%{transform:none}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}',
    ]) expect(style).toContain(k);
  });
  it('scroll reveals are CSS only, inside @supports (no reveal script)', () => {
    expect(style).toContain('@supports (animation-timeline: view()){\n.tv-rv{animation:tvUp linear both;animation-timeline:view();animation-range:entry 0% entry 55%}\n}');
    expect(d.querySelector('[data-reveal]')).toBeNull();
    expect(readFileSync(resolve(process.cwd(), 'apps/web/src/marketing/main.ts'), 'utf8')).not.toMatch(/reveal\.js|initMarketingMotion|IntersectionObserver/);
  });
  it('reduced motion stops everything that moves; stars stay, still, at half opacity', () => {
    expect(style).toContain('@media (prefers-reduced-motion: reduce){.tv-star{animation:none !important;opacity:.5}.tv-col,.tv-missed,.tv-orb,.tv-marq,.tv-up,.tv-rv,.tv-pop,.tv-shake,.tv-fade{animation:none !important}}');
  });
});

describe('[P70] accessibility', () => {
  it('one banner header, one main, one footer; sections labelled', () => {
    expect(d.querySelectorAll('body > header')).toHaveLength(1);
    expect(d.querySelectorAll('main')).toHaveLength(1);
    expect(d.querySelectorAll('body > footer')).toHaveLength(1);
    for (const s of d.querySelectorAll('main section')) expect(s.hasAttribute('aria-labelledby') || s.hasAttribute('aria-label')).toBe(true);
  });
  it('visible focus on every control', () => {
    expect(style).toContain('.tv-tab:focus-visible,.tv-cta:focus-visible,.tv-msg:focus-visible,.tv-btn:focus-visible{outline:2px solid #E8643A;outline-offset:3px}');
  });
  // WCAG 2.x relative luminance contrast
  const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
  it.each([
    ['text on page', '#F2EDE4', '#171412'], ['secondary on page', '#CFC6BA', '#171412'], ['muted on page', '#A79E92', '#171412'],
    ['muted on cards', '#A79E92', '#1F1B18'], ['muted on deep sections', '#A79E92', '#120F0D'], ['text on messages', '#F2EDE4', '#2A2521'],
    ['CTA text on accent', '#171412', '#E8643A'], ['caught card text', '#171412', '#F2EDE4'], ['caught card labels', '#5E554C', '#F2EDE4'],
    ['accent labels on page', '#E8643A', '#171412'], ['highlight text', '#FFD9C9', '#171412'], ['wall lines', '#9C9389', '#221D1A'],
  ])('%s passes AA (4.5:1)', (_n, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('[P70] the claims rule and the wording rules', () => {
  it('NEGATIVE: no people\'s names anywhere on the page (clients are "Property client", "the CFO")', () => {
    expect(html).not.toMatch(/\b(Sara|Sarah|Khan|Priya|Khalid|Omar|Sana|Iqbal)\b/);
    expect(GAMES.map((g) => g.label)).toEqual(['Property', 'Insurance', 'Wealth', 'B2B accounts', 'Luxury', 'Recruitment']); // [P71 · owner] shown as "[Industry] client"
  });
  it('NEGATIVE: no em-dash, no health word, no domain we do not own', () => {
    expect(html).not.toContain('—');
    expect(html).not.toMatch(/pregnan|baby|surgery|hospital|medical|illness|diagnos/i);
    expect(html).not.toMatch(new RegExp(['tovira', 'com'].join('\\.'), 'i'));
  });
  it('the generated blocks in index.html match the data (regenerate: npx tsx apps/web/scripts/gen-landing.ts)', () => {
    const found = fragmentsIn(html);
    expect(Object.keys(found).sort()).toEqual(Object.keys(FRAGMENTS).sort());
    for (const [name, render] of Object.entries(FRAGMENTS)) expect(found[name], name).toBe(render());
  });
  it('the CTAs go to request access (and keep data-cta for the referral pass-through)', () => {
    const ctas = [...d.querySelectorAll<HTMLAnchorElement>('[data-cta]')];
    expect(ctas.map(text)).toEqual(['Try free for 14 days', 'Try free for 14 days', 'Try free for 14 days']); // header, hero, close (the end screen adds a fourth)
    for (const a of ctas) expect(a.getAttribute('href')).toBe('/request-access');
  });
});
