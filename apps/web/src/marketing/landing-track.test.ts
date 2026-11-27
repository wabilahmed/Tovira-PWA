// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { routeOf, trackClicks, beatSink, ROUTES, PLACES } from './landing-track.js';
import { mountScene, LINES } from './scene.js';

/**
 * [P89 · owner, Prompt 86] "Add events so I can see whether the scene works": scene beat reached (1 to 5), Start free
 * clicked (with which beat or section), game banner clicked; every event with its page's route. Cookieless, nothing
 * typed (the P71-T rules), sent on the game's beacon (/api/game-event).
 */
type Sent = Record<string, unknown>;
let sent: Sent[];
beforeEach(() => { sent = []; });

describe('[P89] the route', () => {
  it('the landing and the seven game pages, also by their file address (the redirect while routing waits)', () => {
    expect(routeOf('/')).toBe('/');
    expect(routeOf('/index.html')).toBe('/');
    expect(routeOf('/game')).toBe('/game');
    expect(routeOf('/game/')).toBe('/game');
    expect(routeOf('/game/index.html')).toBe('/game');
    expect(routeOf('/game/wealth/index.html')).toBe('/game/wealth');
    expect(ROUTES).toHaveLength(8);
  });
  it('NEGATIVE: any other page has no route', () => {
    for (const p of ['/app', '/game/plumbing', '/privacy', '/games']) expect(routeOf(p), p).toBeNull();
  });
});

describe('[P89] Start free and banner taps', () => {
  const page = () => {
    document.body.innerHTML = `<header><a data-cta data-place="header" href="/request-access">Start free</a></header>
      <div id="b1"><a data-cta data-place="beat1" href="/request-access"><span>Start free</span></a></div>
      <a data-banner href="/game"><span>Would you have caught it?</span></a>
      <a data-cta data-place="nowhere" href="/request-access">Start free</a>
      <a href="/privacy">Privacy</a>`;
    for (const a of document.querySelectorAll('a')) a.addEventListener('click', (e) => e.preventDefault());
    trackClicks(document, '/', (b) => sent.push(b));
  };
  it('a Start free tap sends its place and route; the banner sends game_banner; nothing else is counted', () => {
    page();
    (document.querySelector('[data-place="header"]') as HTMLElement).click();
    (document.querySelector('#b1 span') as HTMLElement).click(); // a tap on the label inside counts as the link
    (document.querySelector('[data-banner] span') as HTMLElement).click();
    (document.querySelector('[data-place="nowhere"]') as HTMLElement).click();
    (document.querySelector('a[href="/privacy"]') as HTMLElement).click();
    expect(sent).toEqual([{ event: 'start_click', place: 'header', route: '/' }, { event: 'start_click', place: 'beat1', route: '/' }, { event: 'game_banner', route: '/' }]);
  });
  it('the places are the six Start free buttons the pages carry', () => {
    expect(PLACES).toEqual(['header', 'beat1', 'beat5', 'pricing', 'closing', 'game_close']);
  });
});

describe('[P89] scene beats', () => {
  it('beatSink sends scene_beat with the beat and the route', () => {
    beatSink('/', (b) => sent.push(b))(3);
    expect(sent).toEqual([{ event: 'scene_beat', beat: 3, route: '/' }]);
  });
  it('with reduced motion, each beat is counted once when it comes on screen (the message counts as beats 2 and 3)', () => {
    document.documentElement.className = '';
    document.body.innerHTML = '<section id="scene"><div class="cols"><div id="c1"></div><div id="c2"></div><div id="c3"></div></div><div id="b1"></div><div id="b2"><div id="big"></div><div id="stroke"></div><p id="cap3"></p></div><div id="b4"></div><div id="b5"></div></section>';
    const seen: Array<(es: Array<{ isIntersecting: boolean; target: Element }>) => void> = [];
    (globalThis as Record<string, unknown>).IntersectionObserver = class { constructor(cb: never) { seen.push(cb); } observe() {} disconnect() {} };
    const win = Object.assign(Object.create(window), { matchMedia: (q: string) => ({ matches: q.includes('reduce') }) }) as Window;
    const beats: number[] = [];
    mountScene(document, win, (b) => beats.push(b));
    expect(document.getElementById('c1')!.children).toHaveLength(84);
    seen[0]!([{ isIntersecting: true, target: document.getElementById('b2')! }]);
    expect(beats).toEqual([1, 2, 3]);
    seen[0]!([{ isIntersecting: true, target: document.getElementById('b2')! }, { isIntersecting: true, target: document.getElementById('b5')! }]);
    expect(beats).toEqual([1, 2, 3, 4, 5]);
  });
  it('NEGATIVE: the decorative chat lines name no budget and no place', () => {
    expect(LINES.join(' ')).not.toMatch(/budget|family office/i);
  });
});
