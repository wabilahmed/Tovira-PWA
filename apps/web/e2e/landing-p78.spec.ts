import { test, expect, type Page } from '@playwright/test';
import { GAMES } from '../src/marketing/landing-data.js';

/**
 * [P78 · owner] Game clarity, in a real browser at 390 and 1440:
 *  - the pick screen is one line, then the 6 industries (no HOW IT WORKS);
 *  - when a chat starts, the two rule lines ("Find the N messages that help you close the deal." and "Pick a wrong one
 *    and you fail this chat.") are on screen without scrolling, bold, 17px / 18px and 15px in the accent;
 *  - the counter reads "0 of N found", then "1 of N found" after a correct tap.
 * With SHOTS_DIR set, the review screenshots are saved there (not committed).
 */
async function shot(page: Page, name: string): Promise<void> {
  if (!process.env.SHOTS_DIR) return;
  await page.waitForTimeout(900); // let the entrance fade and any smooth scroll finish: the shot is what the visitor sees
  await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` }); // the whole screen, as it is, no scrolling
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/visit', (r) => r.fulfill({ status: 204, body: '' }));
  await page.route('**/api/game-event', (r) => r.fulfill({ status: 204, body: '' }));
});

/** Is the element fully between the sticky header's bottom and the bottom of the screen? */
const onScreen = (page: Page, sel: string) => page.evaluate((s) => {
  const r = document.querySelector(s)!.getBoundingClientRect();
  const hb = document.querySelector('body > header')?.getBoundingClientRect().bottom ?? 0;
  return r.top >= hb && r.bottom <= innerHeight && r.height > 0;
}, sel);

// Property: the first chat with more than one detail, so one correct tap leaves the chat open
const R = GAMES[0]!.chats.findIndex((c) => c.filter((m) => m.sig).length >= 2);
const SIGS = GAMES[0]!.chats[R]!.flatMap((m, i) => (m.sig ? [i] : []));

for (const [width, height, ruleSize] of [[390, 844, 17], [1440, 900, 18]] as const) {
  test(`${width}px: one line on the pick screen; the rules on screen when a chat starts; the counter`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/#game');
    const card = page.locator('[data-game]');
    await expect(card.getByRole('button')).toHaveCount(6);
    await expect(card).toContainText('Clients drop details that win deals. Can you spot them? Pick your industry to start.');
    await expect(card).not.toContainText('HOW IT WORKS');
    await shot(page, `p78-pick-${width}`);

    await card.getByRole('button', { name: 'Property' }).click();
    const n1 = GAMES[0]!.chats[0]!.filter((m) => m.sig).length;
    await expect(card.locator('[data-g="rule"]')).toHaveText(n1 === 1 ? 'Find the 1 message that helps you close the deal.' : `Find the ${n1} messages that help you close the deal.`);
    await expect(card.locator('[data-g="warn"]')).toHaveText('Pick a wrong one and you fail this chat.');
    // the visitor doesn't scroll; on mobile the page may bring the card's top under the header (420ms), so wait for it
    await expect.poll(() => onScreen(page, '[data-g="rule"]'), { message: 'line 1 visible without scrolling' }).toBe(true);
    await expect.poll(() => onScreen(page, '[data-g="warn"]'), { message: 'line 2 visible without scrolling' }).toBe(true);
    const css = (sel: string) => card.locator(sel).evaluate((e) => { const c = getComputedStyle(e); return { size: c.fontSize, weight: c.fontWeight, color: c.color }; });
    expect(await css('[data-g="rule"]')).toEqual({ size: `${ruleSize}px`, weight: '700', color: 'rgb(242, 237, 228)' });
    expect(await css('[data-g="warn"]')).toEqual({ size: '15px', weight: '700', color: 'rgb(232, 100, 58)' });
    for (const sel of ['[data-g="meta"]', '[data-g="score"]']) expect(parseFloat((await css(sel)).size)).toBeLessThan(15);
    await expect(card.locator('[data-g="counter"]')).toHaveText(`0 of ${n1} found`);
    await shot(page, `p78-chat-start-${width}`);

    // play through to a chat with 2+ details, then one correct tap
    for (let r = 0; r < R; r++) {
      for (const i of GAMES[0]!.chats[r]!.flatMap((m, j) => (m.sig ? [j] : []))) await card.locator(`[data-i="${i}"]`).click();
      await card.locator('[data-act="next"]').click();
    }
    await expect(card.locator('[data-g="rule"]')).toHaveText(`Find the ${SIGS.length} messages that help you close the deal.`);
    // on mobile the new chat brings the card's top under the header with a 420ms smooth scroll (P76), so wait for it
    await expect.poll(() => onScreen(page, '[data-g="rule"]'), { message: 'line 1 visible at the new chat' }).toBe(true);
    await expect.poll(() => onScreen(page, '[data-g="warn"]'), { message: 'line 2 visible at the new chat' }).toBe(true);
    await expect(card.locator('[data-g="counter"]')).toHaveText(`0 of ${SIGS.length} found`);
    await card.locator(`[data-i="${SIGS[0]}"]`).click();
    await expect(card.locator('[data-g="counter"]')).toHaveText(`1 of ${SIGS.length} found`);
    await expect(card.locator('[data-act="next"]')).toHaveCount(0); // still playing
    await shot(page, `p78-one-correct-${width}`);
  });
}

test('390px: picking an industry with the card top scrolled off screen brings the rules into view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const card = page.locator('[data-game]');
  await expect(card.getByRole('button')).toHaveCount(6);
  // the visitor has scrolled down so the industry buttons sit near the top and the card's top is off screen
  await page.evaluate(() => scrollTo({ top: scrollY + document.querySelector('[data-game]')!.getBoundingClientRect().top + 86, behavior: 'instant' }));
  expect(await onScreen(page, '[data-game] p')).toBe(false);
  await page.evaluate(() => (document.querySelector('[data-act="start"][data-gi="0"]') as HTMLElement).click());
  await expect.poll(() => onScreen(page, '[data-g="rule"]')).toBe(true);
  await expect.poll(() => onScreen(page, '[data-g="warn"]')).toBe(true);
});

test('NEGATIVE 1440px: picking an industry never scrolls the page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => { (window as unknown as { n: number }).n = 0; const o = window.scrollTo.bind(window); window.scrollTo = ((...a: Parameters<typeof window.scrollTo>) => { (window as unknown as { n: number }).n++; return o(...a); }) as typeof window.scrollTo; });
  await page.locator('[data-act="start"][data-gi="0"]').click();
  await expect(page.locator('[data-g="rule"]')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { n: number }).n)).toBe(0);
});

// [P78] Found while testing P78, and live on tovira.io: the hero section was overflow: hidden, which a browser can still
// scroll inside (a #game jump, scrollIntoView). On mobile, after Play the game and back to the top, the headline's first
// lines stayed cut off (the section had scrolled 154px inside, and a visitor can't scroll it back). overflow: clip clips
// the same and can't be scrolled.
for (const width of [390, 1440]) {
  test(`${width}px: after Play the game / Test your eye and back to the top, the headline is whole`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/');
    await page.locator(width === 390 ? '.tv-mobplay' : 'body > header nav a[href="#game"]').first().click();
    await page.waitForTimeout(900);
    // what a #game jump or scrollIntoView can do to a section the page can't scroll: scroll it inside
    await page.evaluate(() => { const s = document.getElementById('top')!; s.scrollTop = 154; s.scrollLeft = 79; });
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    const r = await page.evaluate(() => { const s = document.getElementById('top')!; return { T: s.scrollTop, L: s.scrollLeft, h1: document.querySelector('h1')!.getBoundingClientRect().top, sec: s.getBoundingClientRect().top }; });
    expect(r.T).toBe(0);
    expect(r.L).toBe(0);
    expect(r.h1).toBeGreaterThanOrEqual(r.sec);
  });
}
