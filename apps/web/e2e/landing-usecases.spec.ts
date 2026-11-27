import { test, expect, type Page } from '@playwright/test';

/**
 * [P70 · owner] The rebuilt landing page in a real browser (this file was the P41-2 use-case grid check).
 * [P89 · owner, Prompt 86] Now the Marker landing and the game's own pages, in a real browser:
 *  - the headline and Start free are on screen at first paint, without scrolling and with no loading state (with and
 *    without JavaScript);
 *  - no sideways scroll at 375px, at any point of the scene, nor on the game pages;
 *  - with reduced motion, all five beats show as a plain stacked page and nothing animates;
 *  - the scene at its five stops, 0, 0.25, 0.5, 0.75 and 1 (owner, 28 Nov; were 0, 0.25, 0.4, 0.7 and 0.95), at 1440x900
 *    and 390x844: one beat at a time, fully shown, whole on screen below the header, no text overlapping (saved to
 *    SHOTS_DIR for the owner when set);
 *  - [owner, 28 Nov] never a blank or half-faded screen: at every 2% of progress a beat is at opacity 0.25 or more; a
 *    small scroll down from each stop settles on the next stop and a small scroll up on the previous one (desktop wheel,
 *    and a 390px touch screen); past the last stop the page scrolls on; back up from below settles on the last stop;
 *    a touch cancels the settle; no settle with reduced motion;
 *  - every link and question is reachable by keyboard, and a beat's link scrolls its beat into view when focused;
 *  - every text colour clears 4.5:1 on what is actually behind it;
 *  - the seven game routes answer 200 with their H1 in the raw HTML, the sitemap lists them, an old /#game link opens
 *    /game, and the game plays by tapping (P71/P73), its events carrying the page's route;
 *  - the scene's counts: each beat reached once, Start free taps by place, the game banner.
 */
const ROUTES = ['/game', '/game/property', '/game/insurance', '/game/wealth', '/game/b2b', '/game/luxury', '/game/recruitment'];
const H1 = ['Can you spot the detail that wins the deal?', ...['Property', 'Insurance', 'Wealth', 'B2B', 'Luxury', 'Recruitment'].map((n) => `${n} sales test: can you spot the detail that wins the deal?`)];

async function shot(page: Page, name: string, opts: { full?: boolean; el?: ReturnType<Page['locator']> } = {}): Promise<void> {
  if (!process.env.SHOTS_DIR) return;
  const path = `${process.env.SHOTS_DIR}/${name}.png`;
  if (opts.el) await opts.el.screenshot({ path });
  else await page.screenshot({ path, fullPage: opts.full ?? false });
}
const noSideScroll = async (page: Page, what = '') => {
  const { scrollW, clientW } = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
  expect(scrollW, `sideways scroll ${what}`).toBeLessThanOrEqual(clientW);
};
/** Scroll so the scene is at progress p (0 to 1), and let two frames draw it. */
const toProgress = async (page: Page, p: number) => {
  await page.evaluate((x) => { const s = document.getElementById('scene')!; const top = s.getBoundingClientRect().top + scrollY; scrollTo({ top: top + x * (s.offsetHeight - innerHeight), behavior: 'instant' }); }, p);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(80);
};
/** What the scene shows: each beat's opacity and box, the header's bottom, and any two text lines in the shown beat that overlap. */
const sceneState = (page: Page) => page.evaluate(() => {
  const beats = ['b1', 'b2', 'b4', 'b5'].map((id) => {
    const el = document.getElementById(id)!;
    const r = el.getBoundingClientRect();
    return { id, o: parseFloat(getComputedStyle(el).opacity), top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
  const shown = beats.filter((b) => b.o > 0.05);
  const overlaps: string[] = [];
  for (const b of shown) {
    const parts = [...document.getElementById(b.id)!.children].filter((c) => getComputedStyle(c).opacity !== '0').map((c) => ({ c: c.className || c.tagName, r: c.getBoundingClientRect() }));
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i]!.r; const z = parts[j]!.r;
      if (a.bottom > z.top + 1 && z.bottom > a.top + 1 && a.right > z.left + 1 && z.right > a.left + 1) overlaps.push(`${b.id}: ${parts[i]!.c} / ${parts[j]!.c}`);
    }
  }
  return { shown, headerBottom: document.querySelector('body > header')!.getBoundingClientRect().bottom, vh: innerHeight, vw: innerWidth, overlaps };
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/visit', (r) => r.fulfill({ status: 204, body: '' }));
  await page.route('**/api/game-event', (r) => r.fulfill({ status: 204, body: '' }));
});

test.describe('[P89] first paint', () => {
  for (const js of [true, false]) {
    test(`the headline and Start free are on screen at first paint, without scrolling (JavaScript ${js ? 'on' : 'off'})`, async ({ browser }) => {
      for (const [width, height] of [[390, 844], [1440, 900]] as const) {
        const ctx = await browser.newContext({ javaScriptEnabled: js, viewport: { width, height } });
        const page = await ctx.newPage();
        await page.route('**/api/**', (r) => r.fulfill({ status: 204, body: '' }));
        await page.goto('/', { waitUntil: 'commit' });
        await page.waitForSelector('h1', { state: 'attached' });
        await expect(page.locator('h1')).toBeInViewport({ ratio: 1 });
        await expect(page.locator('#b1 a.pill')).toBeInViewport({ ratio: 1 });
        expect(await page.locator('h1').evaluate((e) => parseFloat(getComputedStyle(e).opacity))).toBe(1);
        expect(await page.evaluate(() => scrollY)).toBe(0);
        await ctx.close();
      }
    });
  }
});

test('375px: no sideways scroll anywhere on the landing (every scene position) or on a game page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  for (const p of [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.95, 1]) { await toProgress(page, p); await noSideScroll(page, `p=${p}`); }
  await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await noSideScroll(page, 'bottom');
  for (const r of ['/game/', '/game/property/']) { await page.goto(r); await noSideScroll(page, r); }
});

test('reduced motion: the five beats are a plain stacked page, all shown, and nothing animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, height] of [[390, 844], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.classList.contains('scene-on'))).toBe(false);
    for (const id of ['b1', 'b2', 'cap3', 'b4', 'b5']) {
      expect(await page.locator(`#${id}`).evaluate((e) => parseFloat(getComputedStyle(e).opacity)), id).toBe(1);
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
    expect(await page.locator('#stroke').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a)).toBeGreaterThan(0.99); // the marker, drawn
    await expect(page.locator('.cols')).toBeHidden();
    // in order down the page, none on top of another
    const tops = await page.evaluate(() => ['b1', 'b2', 'b4', 'b5'].map((id) => { const r = document.getElementById(id)!.getBoundingClientRect(); return [r.top + scrollY, r.bottom + scrollY]; }));
    for (let i = 1; i < tops.length; i++) expect(tops[i]![0], `beat ${i + 1} below beat ${i}`).toBeGreaterThanOrEqual(tops[i - 1]![1]);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    expect(running).toBe(0);
    await shot(page, `p89-reduced-motion-${width}`, { full: true });
  }
});

test('without JavaScript the beats are a plain stacked page too (nothing is left hidden)', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/');
  for (const id of ['b1', 'b2', 'cap3', 'b4', 'b5']) expect(await page.locator(`#${id}`).evaluate((e) => parseFloat(getComputedStyle(e).opacity)), id).toBe(1);
  await ctx.close();
});

for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  test(`${width}x${height}: the scene at its stops 0, 0.25, 0.5, 0.75 and 1: one beat at a time, whole, below the header, no overlap`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.classList.contains('scene-on'))).toBe(true);
    const expected: Record<string, string> = { '0': 'b1', '0.25': 'b2', '0.5': 'b2', '0.75': 'b4', '1': 'b5' };
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      await toProgress(page, p);
      const s = await sceneState(page);
      expect(s.shown.map((b) => b.id), `p=${p}: one beat`).toEqual([expected[String(p)]]);
      const b = s.shown[0]!;
      expect(b.o, `p=${p}: fully shown`).toBe(1);
      expect(b.top, `p=${p}: below the header`).toBeGreaterThanOrEqual(s.headerBottom);
      expect(b.bottom, `p=${p}: not cut off at the bottom`).toBeLessThanOrEqual(s.vh);
      expect(b.left, `p=${p}: not cut off at the side`).toBeGreaterThanOrEqual(0);
      expect(b.right, `p=${p}: not cut off at the side`).toBeLessThanOrEqual(s.vw);
      expect(s.overlaps, `p=${p}: no text overlapping`).toEqual([]);
      const stroke = await page.locator('#stroke').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a);
      if (p === 0.25) expect(stroke, 'the message, before the marker').toBeLessThan(0.01);
      if (p === 0.5) {
        expect(stroke, 'the marker stroke is complete').toBeGreaterThan(0.99);
        expect(await page.locator('#cap3').evaluate((e) => parseFloat(getComputedStyle(e).opacity))).toBe(1);
      }
      await shot(page, `p89-scene-${width}-${String(p).replace('.', '')}`);
    }
    // phones show two chat columns, desktops three
    expect(await page.locator('.col:visible').count()).toBe(width < 641 ? 2 : 3);
  });
}

/** The scene's progress now (unclamped), and the scroll position. */
const where = (page: Page) => page.evaluate(() => {
  const s = document.getElementById('scene')!; const top = s.getBoundingClientRect().top + scrollY; const max = s.offsetHeight - innerHeight;
  return { p: (scrollY - top) / max, y: scrollY, top, max };
});
/** Wait until the page has stopped moving (no change over 300ms), then say where it is. */
const settled = async (page: Page) => {
  let last = -1;
  for (let i = 0; i < 40; i++) { const { y } = await where(page); if (Math.abs(y - last) < 0.5) break; last = y; await page.waitForTimeout(300); }
  return where(page);
};
/** A small scroll the way a visitor makes it: a mouse wheel tick on desktop, a finger swipe on a touch screen. */
async function nudge(page: Page, dy: number, touch: boolean): Promise<void> {
  const before = await page.evaluate(() => scrollY);
  if (!touch) { await page.mouse.move(200, 400); await page.mouse.wheel(0, dy); }
  else {
    // a finger, as raw touch events (the synthetic scroll gesture never scrolls on CI's Linux headless Chromium): it
    // lands in the empty side margin (never on a link), moves at an ordinary pace and lifts
    const cdp = await page.context().newCDPSession(page);
    const x = 8; const y0 = dy > 0 ? 700 : 200; const steps = 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - (dy * i) / steps }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }
  // the visitor's input reached the page (a gesture that never arrived is a test-rig failure, not a settle failure)
  await expect.poll(() => page.evaluate(() => scrollY), { message: `the ${touch ? 'swipe' : 'wheel'} scrolled the page`, timeout: 3000 }).not.toBe(before);
}

test.describe('[P89 · owner, 28 Nov] the scene never leaves a blank or half-faded screen', () => {
  for (const [width, height, touch] of [[1440, 900, false], [390, 844, true]] as const) {
    test(`${width}x${height}${touch ? ' touch' : ''}: at every 2% of progress a beat is at opacity 0.25 or more`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      const page = await ctx.newPage();
      await page.route('**/api/**', (r) => r.fulfill({ status: 204, body: '' }));
      await page.goto('/');
      for (let i = 0; i <= 50; i++) {
        await toProgress(page, i / 50);
        const s = await sceneState(page);
        const top = Math.max(0, ...s.shown.map((b) => b.o));
        expect(top, `p=${(i / 50).toFixed(2)}`).toBeGreaterThanOrEqual(0.25);
      }
      await ctx.close();
    });

    test(`${width}x${height}${touch ? ' touch' : ''}: a small scroll from each stop settles on the next stop down, or the previous one up`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      const page = await ctx.newPage();
      await page.route('**/api/**', (r) => r.fulfill({ status: 204, body: '' }));
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      const STOPS = [0, 0.25, 0.5, 0.75, 1];
      for (let i = 0; i < 4; i++) {
        await toProgress(page, STOPS[i]!); await settled(page);
        await nudge(page, 80, touch);
        const w = await settled(page);
        expect(w.p, `down from ${STOPS[i]}`).toBeCloseTo(STOPS[i + 1]!, 2);
        expect(Math.max(0, ...(await sceneState(page)).shown.map((b) => b.o)), `down from ${STOPS[i]}: the beat is whole`).toBe(1);
      }
      for (let i = 4; i > 0; i--) {
        await toProgress(page, STOPS[i]!); await settled(page);
        await nudge(page, -80, touch);
        const w = await settled(page);
        expect(w.p, `up from ${STOPS[i]}`).toBeCloseTo(STOPS[i - 1]!, 2);
      }
      // past the last stop the page scrolls on into the rest of the page, untouched
      await toProgress(page, 1); await settled(page);
      await nudge(page, 300, touch);
      const past = await settled(page);
      expect(past.y, 'past the last stop: scrolls on').toBeGreaterThan(past.top + past.max + 100);
      // back up into the scene from below settles on the last stop
      await page.evaluate(() => { const s = document.getElementById('scene')!; const top = s.getBoundingClientRect().top + scrollY; scrollTo({ top: top + s.offsetHeight - innerHeight + 400, behavior: 'instant' }); });
      await settled(page);
      await nudge(page, -500, touch);
      const back = await settled(page);
      expect(back.p, 'back up from below: the last stop').toBeCloseTo(1, 2);
      await ctx.close();
    });
  }

  test('a touch cancels the settle, and the visitor\'s own scrolling is never held back', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => r.fulfill({ status: 204, body: '' }));
    await page.goto('/');
    await toProgress(page, 0.3); // between stops, moving down: the settle heads for 0.5
    // the moment the glide is under way, a finger lands on the screen
    const caught = await page.evaluate(() => new Promise<number>((done) => {
      const s = document.getElementById('scene')!; const top = s.getBoundingClientRect().top + scrollY; const max = s.offsetHeight - innerHeight;
      const from = scrollY;
      const tick = () => { if (scrollY > from + 4) { window.dispatchEvent(new TouchEvent('touchstart', { touches: [] })); done((scrollY - top) / max); } else requestAnimationFrame(tick); };
      tick();
    }));
    expect(caught, 'the glide had begun').toBeGreaterThan(0.3);
    const a = await settled(page);
    expect(a.p, 'it stopped where the touch caught it, short of the stop').toBeLessThan(0.49);
    expect(a.p - caught, 'and went no further').toBeLessThan(0.02);
    await ctx.close();
  });

  test('no settle with reduced motion: the page stays where the visitor left it', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => r.fulfill({ status: 204, body: '' }));
    await page.goto('/');
    await page.evaluate(() => scrollTo({ top: 1234, behavior: 'instant' }));
    await page.mouse.move(200, 400); await page.mouse.wheel(0, 60);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => scrollY)).toBe(1294);
    await ctx.close();
  });
});

test('the scene loop stops when the scene is off screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(200);
  const a = await page.locator('#c2').evaluate((e) => getComputedStyle(e).transform);
  await page.waitForTimeout(400);
  expect(await page.locator('#c2').evaluate((e) => getComputedStyle(e).transform), 'the columns stop drifting off screen').toBe(a);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);
  const b = await page.locator('#c2').evaluate((e) => getComputedStyle(e).transform);
  await page.waitForTimeout(400);
  expect(await page.locator('#c2').evaluate((e) => getComputedStyle(e).transform), 'and drift again on screen').not.toBe(b);
});

test('keyboard: every link and question is reachable with Tab; a beat\'s Start free brings its beat into view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const want = await page.evaluate(() => [...document.querySelectorAll('a[href], summary, button')].filter((e) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === 'fixed').length);
  const seen = new Set<string>();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const beat = el.closest('.beat') as HTMLElement | null;
      return { key: `${el.tagName}|${el.getAttribute('href') ?? ''}|${el.textContent?.trim().slice(0, 30)}|${[...document.querySelectorAll('a[href], summary, button')].indexOf(el)}`, inView: r.bottom > 0 && r.top < innerHeight, beatOpacity: beat ? parseFloat(getComputedStyle(beat).opacity) : 1 };
    });
    if (!f) break;
    if (seen.has(f.key)) break;
    seen.add(f.key);
    // the browser brings a focused link into view (smoothly: the page scrolls smooth), and a beat's link its beat
    const now = () => page.evaluate(() => { const el = document.activeElement as HTMLElement; const r = el.getBoundingClientRect(); const beat = el.closest('.beat') as HTMLElement | null; return { inView: r.bottom > 0 && r.top < innerHeight, beatOpacity: beat ? parseFloat(getComputedStyle(beat).opacity) : 1 }; });
    await expect.poll(async () => (await now()).inView, { message: `${f.key} on screen when focused`, timeout: 3000 }).toBe(true);
    await expect.poll(async () => (await now()).beatOpacity, { message: `${f.key}: its beat is shown when focused`, timeout: 3000 }).toBeGreaterThan(0.9);
  }
  expect(seen.size).toBe(want);
});

test('contrast: every visible text on the landing and a game page clears 4.5:1 on what is behind it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // the stacked page: every beat at full opacity
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of ['/', '/game/', '/game/wealth/']) {
    await page.goto(path);
    if (path !== '/') { // a played chat: the hit, the missed and the finished messages
      const card = page.locator('[data-game]');
      if (path !== '/game/') { await card.locator('button.tv-msg').nth(0).click(); }
    }
    const bad = await page.evaluate(() => {
      const parse = (c: string) => { const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(c); return m ? [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]] as const : null; };
      const lum = (r: number, g: number, b: number) => { const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const behind = (el: Element): [number, number, number] => {
        for (let e: Element | null = el; e; e = e.parentElement) {
          const bg = parse(getComputedStyle(e).backgroundColor);
          if (bg && bg[3] > 0.5) return [bg[0], bg[1], bg[2]];
          const img = getComputedStyle(e).backgroundImage; // the marker underline: text sits on the yellow
          if (img.includes('255, 228, 92')) return [255, 228, 92];
        }
        return [250, 250, 250];
      };
      const out: string[] = [];
      for (const el of document.body.querySelectorAll('*')) {
        if (el.closest('[aria-hidden="true"]') || el.closest('svg')) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
        if (!own) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const fg = parse(getComputedStyle(el).color)!;
        const bg = behind(el);
        const [a, b] = [lum(fg[0], fg[1], fg[2]), lum(bg[0], bg[1], bg[2])].sort((x, y) => y - x);
        const ratio = (a! + 0.05) / (b! + 0.05);
        if (ratio < 4.5) out.push(`${el.tagName}.${(el as HTMLElement).className} "${el.textContent!.trim().slice(0, 30)}" ${ratio.toFixed(2)}`);
      }
      return out;
    });
    expect(bad, path).toEqual([]);
  }
});

test.describe('[P89] the game pages', () => {
  test('the seven routes answer 200 with their H1 in the raw HTML (clean address and with the slash)', async ({ request }) => {
    for (const [i, r] of ROUTES.entries()) {
      for (const path of [r, `${r}/`]) {
        const res = await request.get(path);
        expect(res.status(), path).toBe(200);
        const html = await res.text();
        expect(html, path).toContain(`<h1 class="g-h1" id="game-h">${H1[i]}</h1>`);
        expect(html, path).toContain(`<link rel="canonical" href="https://tovira.io${r}" />`);
      }
    }
  });
  test('the sitemap is served and lists them', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    for (const r of ROUTES) expect(xml).toContain(`<loc>https://tovira.io${r}</loc>`);
  });
  test('an old /#game link opens /game', async ({ page }) => {
    await page.goto('/#game');
    await expect(page).toHaveURL(/\/game\/?$/);
    await expect(page.locator('h1')).toHaveText('Can you spot the detail that wins the deal?');
  });
  test('the landing\'s banner and the header open /game; /game links each industry; each industry links /game', async ({ page }) => {
    await page.goto('/');
    await page.locator('a[data-banner]').click();
    await expect(page).toHaveURL(/\/game\/?$/);
    await page.locator('[data-game]').getByRole('link', { name: 'Wealth' }).click();
    await expect(page).toHaveURL(/\/game\/wealth\/?$/);
    await expect(page.locator('h1')).toHaveText('Wealth sales test: can you spot the detail that wins the deal?');
    await page.locator('nav.g-more').getByRole('link', { name: 'All industries' }).click();
    await expect(page).toHaveURL(/\/game\/?$/);
  });

  for (const width of [390, 1440]) {
    test(`${width}px: play Property by tapping: a perfect chat, a failed chat reveals and locks, the end screen; events carry the route`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const events: Array<Record<string, unknown>> = [];
      await page.route('**/api/game-event', async (r) => { events.push(JSON.parse(r.request().postData() ?? '{}')); await r.fulfill({ status: 204, body: '' }); });
      await page.goto('/game/property/');
      const card = page.locator('[data-game]');
      await expect(card).toContainText('Property client · chat 1 of 5');
      await expect(card).toContainText('Pick a wrong one and you fail this chat.');
      const msgs = card.locator('button.tv-msg');
      await expect(msgs).toHaveCount(5);
      await msgs.nth(1).click();
      await expect(msgs.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(msgs.nth(1)).toContainText('+1 · Needs 3+ bedrooms');
      await expect(msgs.nth(1)).toContainText('Why it counts:');
      expect(await msgs.nth(1).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 228, 92)'); // the caught message, marked
      await shot(page, `p89-game-correct-${width}`, { el: card });
      await expect(card.locator('[aria-live="polite"]')).toContainText('You caught it.');
      await card.locator('[data-act="next"]').click();
      await expect(card).toContainText('Property client · chat 2 of 5');
      await msgs.nth(1).click(); // a logistics trap ends the chat
      await expect(msgs.nth(1)).toContainText('Not a buying signal. That ended this chat.');
      for (const i of [0, 2]) await expect(msgs.nth(i)).toContainText('You missed it:');
      for (let i = 0; i < 5; i++) await expect(msgs.nth(i)).toBeDisabled();
      await expect(card.locator('[aria-live="polite"]')).toContainText('You missed both.');
      await shot(page, `p89-game-wrong-${width}`, { el: card });
      for (let r = 2; r < 5; r++) { await card.locator('[data-act="next"]').click(); await expect(card).toContainText(`chat ${r + 1} of 5`); await msgs.nth(1).click(); }
      await card.locator('[data-act="next"]').click();
      await expect(card).toContainText('YOUR SCORE · PROPERTY');
      await expect(card).toContainText('1/11');
      await expect(page.locator('.g-close')).toContainText('Tovira catches every one of them for you.');
      await shot(page, `p89-game-end-${width}`, { full: true });
      await noSideScroll(page, 'end screen');
      // [P89 · owner, 28 Nov] game_start and game_view leave the page as two separate beacons the moment it opens, and
      // CI run 46069986180 caught them arriving the other way round: the page sends them in order, but nothing orders
      // their arrival. So those two are checked in either order; everything after them stays in strict order.
      await expect.poll(() => [[...events.slice(0, 2).map((e) => e.event)].sort(), ...events.slice(2).map((e) => e.event)]).toEqual([['game_start', 'game_view'], 'chat_done', 'chat_done', 'chat_done', 'chat_done', 'chat_done', 'game_done']);
      for (const e of events) expect(e.route, JSON.stringify(e)).toBe('/game/property');
      expect(events.find((e) => e.event === 'game_start')).toEqual({ event: 'game_start', industry: 'Property', route: '/game/property' });
      await page.locator('.g-close a[data-cta]').evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
      await page.locator('.g-close a[data-cta]').click();
      await expect.poll(() => events.at(-1)).toEqual({ event: 'start_click', place: 'game_close', route: '/game/property' });
    });
  }

  test('/game: the pick screen fits on a 1440x900 screen with the H1 above it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/game/');
    const card = await page.locator('[data-game]').boundingBox();
    expect(card!.y + card!.height).toBeLessThanOrEqual(900);
    await shot(page, 'p89-game-pick-1440');
  });
});

test('the scene\'s counts: each beat once, Start free by place, the banner', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const events: Array<Record<string, unknown>> = [];
  await page.unroute('**/api/game-event');
  await page.route('**/api/game-event', async (r) => { events.push(JSON.parse(r.request().postData() ?? '{}')); await r.fulfill({ status: 204, body: '' }); });
  await page.goto('/');
  for (const p of [0, 0.3, 0.5, 0.75, 0.97, 0.5, 0]) await toProgress(page, p);
  await expect.poll(() => events.filter((e) => e.event === 'scene_beat').map((e) => e.beat)).toEqual([1, 2, 3, 4, 5]);
  for (const e of events) expect(e.route).toBe('/');
  await page.evaluate(() => { for (const a of document.querySelectorAll('a')) a.addEventListener('click', (e) => e.preventDefault()); });
  await page.locator('body > header a[data-cta]').click();
  await page.locator('a[data-banner]').click();
  await expect.poll(() => events.slice(-2)).toEqual([{ event: 'start_click', place: 'header', route: '/' }, { event: 'game_banner', route: '/' }]);
});
