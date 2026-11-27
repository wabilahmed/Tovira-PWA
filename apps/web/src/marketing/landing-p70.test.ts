// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { discSvg, headerHtml, footerHtml } from './marker.js';
import { BEATS, SETTLE_MS, beatAt, frameAt, settleTarget } from './scene.js';

/**
 * [P70 · owner] The landing page rebuilt from the approved design; these tests read the REAL shipped landing HTML.
 * [P89 · owner, Prompt 86] The P70 page (dark, serif, orange: stars, orbs, marquee, chat wall, industry tabs, the game in
 * the hero) is replaced by the owner's Marker page, ported from plan/tovira-landing-marker.html word for word, with the
 * owner's claim corrections of 27 Nov. Every P70 pin moves here with that note: the meta and share text, the hero, the
 * sections in order, the header, the steps, the plan, the FAQ, the close and footer, no sticky bottom button, motion
 * (only transform and opacity, the scene's five beats, reduced motion), accessibility and the wording rules. The pieces the
 * owner removed are pinned as gone. The brand and copy rules for every public page are brand-guard.test.ts and
 * copy-guard.test.ts.
 */
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const ref = readFileSync(resolve(process.cwd(), 'plan/tovira-landing-marker.html'), 'utf8');
const d = new DOMParser().parseFromString(html, 'text/html');
const r = new DOMParser().parseFromString(ref, 'text/html');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const DESC = 'Tovira reads your client chats and catches the details that close deals.';
const TITLE = 'Tovira: walk into every meeting knowing what matters to them';

describe('[P70→P89] meta and share', () => {
  it('title, description, OG and Twitter text, theme colour, light colour scheme', () => {
    expect(d.title).toBe(TITLE);
    for (const sel of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) expect(d.querySelector(sel)?.getAttribute('content'), sel).toBe(DESC);
    for (const sel of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) expect(d.querySelector(sel)?.getAttribute('content'), sel).toBe(TITLE);
    expect(d.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#FAFAFA');
    expect(d.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe('light');
    expect(d.querySelector('meta[property="og:image:width"]')?.getAttribute('content')).toBe('1200');
    expect(d.querySelector('meta[property="og:image:height"]')?.getAttribute('content')).toBe('630');
  });
});

describe('[P89] the page is the reference, word for word', () => {
  const words = (doc: Document) => {
    const main = doc.querySelector('main')!.cloneNode(true) as HTMLElement;
    main.querySelector('footer')?.remove(); // the reference keeps its footer inside main; the page's is a landmark after it
    return text(main);
  };
  it('main\'s text is the reference\'s main, word for word (the owner\'s copy, with the 27 Nov corrections)', () => {
    expect(words(d)).toBe(words(r));
  });
  it('the header\'s and the footer\'s words are the reference\'s (the footer\'s address is a link)', () => {
    expect(text(d.querySelector('body > header'))).toBe(text(r.querySelector('body > header')));
    expect(text(d.querySelector('body > footer'))).toBe(text(r.querySelector('footer')));
    expect(d.querySelector('footer a[href="mailto:hello@tovira.io"]')).not.toBeNull();
  });
  it('the header and footer are the shared Marker pieces (marker.ts), as the game pages draw them', () => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
    expect(norm(d.querySelector('body > header')!.outerHTML)).toBe(norm(new DOMParser().parseFromString(headerHtml({ logoHref: '#top', links: [{ href: '/game', label: 'The game' }, { href: '#privacy', label: 'Privacy' }, { href: '#pricing', label: 'Pricing' }] }), 'text/html').body.firstElementChild!.outerHTML));
    expect(norm(d.querySelector('body > footer')!.outerHTML)).toBe(norm(new DOMParser().parseFromString(footerHtml(), 'text/html').body.firstElementChild!.outerHTML));
    expect(norm(d.querySelector('.logo svg')!.outerHTML)).toBe(norm(new DOMParser().parseFromString(discSvg(), 'text/html').body.firstElementChild!.outerHTML));
  });
});

describe('[P70→P89] the hero (the scene\'s first beat)', () => {
  it('headline with "what matters" marked, the sub, Start free and the scroll hint', () => {
    expect(text(d.querySelector('#b1 h1'))).toBe('Walk into every meeting knowing what matters to them.');
    expect(text(d.querySelector('#b1 h1 .mk'))).toBe('what matters');
    expect(text(d.querySelector('#b1 .sub'))).toBe(DESC);
    const a = d.querySelector<HTMLAnchorElement>('#b1 a.pill')!;
    expect([text(a), a.getAttribute('href'), a.hasAttribute('data-cta')]).toEqual(['Start free', '/request-access', true]);
    expect(text(d.querySelector('#b1 .hint'))).toBe('Scroll to see how');
  });
  it('NEGATIVE: the P70 hero is gone: no stars, orbs, marquee, wall, tabs, game card or old headline', () => {
    expect(d.querySelectorAll('.tv-star, .tv-orb, .tv-marq, .tv-wall, .tv-col, [role="tablist"], [data-game], [data-world-panel]')).toHaveLength(0);
    expect(html).not.toContain('The detail that wins the deal is already in your chats');
    expect(html).not.toContain('Try free for 14 days');
    expect(html).not.toContain('<!--gen:');
  });
});

describe('[P70→P89] the sections, in order', () => {
  it('the scene\'s five beats, in order', () => {
    expect([...d.querySelectorAll('#scene .beat')].map((b) => b.id)).toEqual(['b1', 'b2', 'b4', 'b5']);
    expect(text(d.querySelector('#b2'))).toBe("Clients tell you what matters. Once. In passing. Honestly we're at the beach every weekend. Tovira marks it.");
    expect(text(d.querySelector('#b4'))).toBe('And keeps it, with the message it came from. Tovira caughtLoves the beach. Every weekend.');
    expect(text(d.querySelector('#b5'))).toBe('Then has it ready before the meeting. Before your Sunday meetingWants a sea viewDecides before SeptemberWorried about the service charge Start free');
  });
  it('the header: the logo, three links (hidden on phones), Log in and Start free', () => {
    const nav = d.querySelector('body > header nav')!;
    expect([...nav.querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href')])).toEqual([
      ['The game', '/game'], ['Privacy', '#privacy'], ['Pricing', '#pricing'], ['Log in', '/app'], ['Start free', '/request-access'],
    ]);
    expect(style).toMatch(/@media \(max-width:640px\)\{\.navlink\{display:none\}/);
    expect(text(d.querySelector('body > header .logo'))).toBe('Tovira');
  });
  it('"Different on purpose": four plain cards in a 2x2 grid (one column on phones), no icons, no yellow', () => {
    const sec = d.getElementById('different-h')!.closest('section')!;
    const cards = [...sec.querySelectorAll('.t2-card')].map((c) => [...c.children].map(text));
    expect(cards).toEqual([
      ['A CRM remembers what you type. Tovira remembers what they said.', 'No data entry. It reads the chat and finds what you never wrote down.'],
      ['AI chatbots wait to be asked. Tovira speaks first.', 'Every day it tells you what needs your attention.'],
      ['Some assistants want your whole WhatsApp. Tovira only sees the chats you send.', 'It never logs in, never sends as you and never messages your clients.'],
      ['Built for selling, not for everything.', 'Promises you made, clients going quiet and what each one is waiting for.'],
    ]);
    expect(sec.querySelector('.t2-grid2')!.getAttribute('style')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(style).toContain('@media (max-width:640px){.t2-grid2{grid-template-columns:1fr !important}}');
    expect(sec.querySelector('svg')).toBeNull();
    expect(sec.outerHTML).not.toMatch(/#FFE45C|var\(--hl\)|class="mk"/i);
  });
  it('the three steps, the six things Tovira does, the four privacy points', () => {
    expect([...d.querySelectorAll('#how .t2-in > div > div > div:nth-child(2)')].map(text)).toEqual(['Export a chat', 'Tovira reads the chat', 'Your brief is ready before the meeting']);
    const does = d.getElementById('does-h')!.closest('section')!;
    expect([...does.querySelectorAll('.t2-card > div:first-child')].map(text)).toEqual(['Catches the details', 'Briefs you before meetings', 'Tracks your promises', 'Warns you when clients go quiet', 'Finds it in one tap', 'Works with voice notes']);
    const trust = d.querySelector('section[aria-labelledby="trust-h"]')!;
    expect([...trust.querySelectorAll('svg + div')].map(text)).toEqual(['It only receives', 'You choose', 'Not used for training', 'Proof for what it catches']);
  });
  it('the plan: AED 299 a month, 10,000 messages, the trial in messages, cancel any time, Start free', () => {
    const plan = d.querySelector('[data-pricing]')!;
    expect(text(plan)).toBe('AED 299 a month 10,000 messages a month14 days free with 5,000 messages. No card.Cancel any time Start free');
  });
  it('the two FAQ questions, as <details>', () => {
    expect([...d.querySelectorAll('details > summary')].map(text)).toEqual(['Do I have to connect my WhatsApp?', 'Who is it not for?']);
  });
  it('the close and the footer', () => {
    expect(text(d.querySelector('#start h2'))).toBe('Your next client already told you something important.');
    expect(text(d.querySelector('#start a[data-cta]'))).toBe('Start free');
    expect(text(d.querySelector('#start a + div'))).toBe('14 days free · No card needed');
    expect(text(d.querySelector('footer'))).toBe('Tovira · Prospera Technologies FZ-LLC · hello@tovira.io PrivacyTerms');
  });
  it('NEGATIVE: no floating or sticky button at the bottom of the page (only the header bar is fixed)', () => {
    expect(d.querySelector('[data-mobile-cta], .mobile-cta')).toBeNull();
    for (const el of d.querySelectorAll('[style]')) expect(el.getAttribute('style')!, el.tagName).not.toMatch(/position:\s*(fixed|sticky)/);
    const fixedRules = [...style.matchAll(/([^{}]+)\{[^}]*position:(fixed|sticky)/g)].map((m) => m[1]!.trim());
    expect(fixedRules).toEqual(['.bar', '.scene-on .stage']);
  });
});

describe('[P70→P89] motion: one pinned scene, five beats', () => {
  // [P89 · owner, 28 Nov, scene scrolling fix] Moved: five stops at 0, 0.25, 0.5, 0.75 and 1 (were 0, 0.27, 0.45,
  // 0.69, 0.94), and the beats now cross-fade, so "no two overlap" is replaced by the owner's rule: no scroll position
  // shows less than one readable beat (opacity 0.25 or more at every 2%).
  it('the beats come in order as you scroll, each whole at its stop (0, 0.25, 0.5, 0.75, 1)', () => {
    expect(BEATS).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(BEATS.map(beatAt)).toEqual([1, 2, 3, 4, 5]);
    const at0 = frameAt(0);
    expect([at0.b1, at0.b2, at0.b4, at0.b5]).toEqual([1, 0, 0, 0]); // the headline on first paint
    const f1 = frameAt(BEATS[1]); expect([f1.b1, f1.b2, f1.b4, f1.b5, f1.b2Lift, f1.big]).toEqual([0, 1, 0, 0, 0, 1]); // the message
    expect(f1.stroke).toBe(0);
    const f2 = frameAt(BEATS[2]); expect([f2.b2, f2.stroke, f2.cap3, f2.b4, f2.b2Lift]).toEqual([1, 1, 1, 0, 0]); // the marker stroke complete
    const f3 = frameAt(BEATS[3]); expect([f3.b2, f3.b4, f3.b5, f3.b4Lift]).toEqual([0, 1, 0, 0]); // the black card
    const f4 = frameAt(BEATS[4]); expect([f4.b4, f4.b5, f4.b5Lift]).toEqual([0, 1, 0]); // the brief
  });
  it('the beats overlap as they change: at every 2% of progress at least one beat is at opacity 0.25 or more', () => {
    for (let i = 0; i <= 50; i++) {
      const f = frameAt(i / 50);
      expect(Math.max(f.b1, f.b2, f.b4, f.b5), `p=${(i / 50).toFixed(2)}`).toBeGreaterThanOrEqual(0.25);
    }
    for (let i = 0; i <= 1000; i++) { const f = frameAt(i / 1000); expect(Math.max(f.b1, f.b2, f.b4, f.b5)).toBeGreaterThanOrEqual(0.5); }
    // the next beat starts in before the last has gone
    expect(frameAt(0.1).b1).toBeGreaterThan(0); expect(frameAt(0.1).b2).toBeGreaterThan(0);
    expect(frameAt(0.6).b2).toBeGreaterThan(0); expect(frameAt(0.6).b4).toBeGreaterThan(0);
    expect(frameAt(0.86).b4).toBeGreaterThan(0); expect(frameAt(0.86).b5).toBeGreaterThan(0);
  });
  it('the settle: between two stops it goes on to the next stop the visitor was heading for', () => {
    expect([0.05, 0.26, 0.49, 0.6, 0.9].map((p) => settleTarget(p, 1))).toEqual([0.25, 0.5, 0.5, 0.75, 1]);
    expect([0.05, 0.26, 0.49, 0.6, 0.9].map((p) => settleTarget(p, -1))).toEqual([0, 0.25, 0.25, 0.5, 0.75]);
    for (const b of BEATS) { expect(settleTarget(b, 1), `on ${b}`).toBeNull(); expect(settleTarget(b, -1), `on ${b}`).toBeNull(); }
    expect(settleTarget(0.4, 0)).toBeNull(); // no direction, no settle
    // past the last stop the page scrolls on (progress is 1 there): no settle; back up into the scene from below: the last stop
    expect(settleTarget(1, 1)).toBeNull();
    expect(settleTarget(0.9, -1, true)).toBe(1);
    expect(settleTarget(0.6, -1, true)).toBe(0.5); // a long fling from below past the last two beats goes by direction
  });
  it('the settle waits about 110ms, never prevents scrolling, and a touch, wheel or key cancels it', () => {
    expect(SETTLE_MS).toBe(110);
    const src = readFileSync(resolve(process.cwd(), 'apps/web/src/marketing/scene.ts'), 'utf8');
    expect(src).not.toMatch(/preventDefault|passive:\s*false|scroll-snap/);
    for (const ev of ['wheel', 'keydown', 'touchstart']) expect(src).toMatch(new RegExp(`addEventListener\\('${ev}', [^\n]*stopGlide`));
    expect(style).toContain('.scene-on .scene{height:420vh}');
    expect(style).not.toMatch(/560vh/);
  });
  it('the scene animates only transform and opacity', () => {
    const src = readFileSync(resolve(process.cwd(), 'apps/web/src/marketing/scene.ts'), 'utf8');
    const written = [...src.matchAll(/\.style\.(\w+)\s*=/g)].map((m) => m[1]);
    expect(new Set(written)).toEqual(new Set(['transform', 'opacity', 'pointerEvents']));
    expect(src).toMatch(/IntersectionObserver/); // the loop stops off screen
    expect(src).toMatch(/visibilitychange/);
  });
  it('the chat columns are decorative and hidden from screen readers; phones show two', () => {
    expect(d.querySelector('.cols')!.getAttribute('aria-hidden')).toBe('true');
    expect(style).toMatch(/@media \(max-width:640px\)\{[^\n]*\.col:nth-child\(3\)\{display:none\}/);
  });
});

describe('[P70→P89] accessibility', () => {
  it('one banner header, one main, one footer; sections labelled', () => {
    expect(d.querySelectorAll('body > header')).toHaveLength(1);
    expect(d.querySelectorAll('main')).toHaveLength(1);
    expect(d.querySelectorAll('body > footer')).toHaveLength(1);
    for (const s of d.querySelectorAll('main section')) expect(s.hasAttribute('aria-labelledby') || s.hasAttribute('aria-label')).toBe(true);
  });
  it('visible focus on every control', () => {
    expect(style).toContain('.pill:focus-visible,.navlink:focus-visible,.login:focus-visible,.logo:focus-visible,.foot a:focus-visible,.t2-cta:focus-visible,summary:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:4px}');
  });
});

describe('[P70→P89] the claims rule and the wording rules', () => {
  it('NEGATIVE: no em-dash, no health word, no domain we do not own', () => {
    expect(html).not.toContain('—');
    expect(html).not.toMatch(/pregnan|baby|surgery|hospital|medical|illness|diagnos/i);
    expect(html).not.toMatch(new RegExp(['tovira', 'com'].join('\\.'), 'i'));
  });
  it('the CTAs go to request access (and keep data-cta for the referral pass-through)', () => {
    const ctas = [...d.querySelectorAll<HTMLAnchorElement>('[data-cta]')];
    expect(ctas).toHaveLength(5);
    for (const a of ctas) { expect(a.getAttribute('href')).toBe('/request-access'); expect(text(a)).toBe('Start free'); }
  });
});
