import { test, expect, type Page } from '@playwright/test';
import { GAMES } from '../src/marketing/landing-data.js';

/**
 * [P78 · owner] Game clarity, in a real browser at 390 and 1440:
 *  - the pick screen is one line, then the 6 industries (no HOW IT WORKS);
 *  - when a chat starts, the two rule lines ("Find the N messages that help you close the deal." and "Pick a wrong one
 *    and you fail this chat.") are on screen without scrolling, bold, 17px / 18px and 15px in the accent;
 *  - the counter reads "0 of N found", then "1 of N found" after a correct tap.
 * With SHOTS_DIR set, the review screenshots are saved there (not committed).
 * [P89 · owner, Prompt 86] The game moved to its own pages in the Marker look: the pick screen is /game (six links), a
 * chat starts on the industry's page (/game/property opens on chat 1, with the rules on screen on arrival), the rule is
 * 17px at every width (one column) and the accent is ink. The old hero's clip check goes with the hero; the page still
 * clips sideways with overflow-x: clip (landing-p78.test.ts).
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

for (const [width, height, ruleSize] of [[390, 844, 17], [1440, 900, 17]] as const) {
  test(`${width}px: one line on the pick screen; the rules on screen when a chat starts; the counter`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/game/');
    let card = page.locator('[data-game]');
    await expect(card.getByRole('link')).toHaveCount(6);
    await expect(card).toContainText('Clients drop details that win deals. Can you spot them? Pick your industry to start.');
    await expect(card).not.toContainText('HOW IT WORKS');
    await shot(page, `p89-pick-${width}`);

    await card.getByRole('link', { name: 'Property' }).click();
    await expect(page).toHaveURL(/\/game\/property/);
    card = page.locator('[data-game]');
    const n1 = GAMES[0]!.chats[0]!.filter((m) => m.sig).length;
    await expect(card.locator('[data-g="rule"]')).toHaveText(n1 === 1 ? 'Find the 1 message that helps you close the deal.' : `Find the ${n1} messages that help you close the deal.`);
    await expect(card.locator('[data-g="warn"]')).toHaveText('Pick a wrong one and you fail this chat.');
    // the visitor doesn't scroll; on mobile the page may bring the card's top under the header (420ms), so wait for it
    await expect.poll(() => onScreen(page, '[data-g="rule"]'), { message: 'line 1 visible without scrolling' }).toBe(true);
    await expect.poll(() => onScreen(page, '[data-g="warn"]'), { message: 'line 2 visible without scrolling' }).toBe(true);
    const css = (sel: string) => card.locator(sel).evaluate((e) => { const c = getComputedStyle(e); return { size: c.fontSize, weight: c.fontWeight, color: c.color }; });
    expect(await css('[data-g="rule"]')).toEqual({ size: `${ruleSize}px`, weight: '700', color: 'rgb(10, 10, 10)' });
    expect(await css('[data-g="warn"]')).toEqual({ size: '15px', weight: '700', color: 'rgb(10, 10, 10)' });
    for (const sel of ['[data-g="meta"]', '[data-g="score"]']) expect(parseFloat((await css(sel)).size)).toBeLessThan(15);
    await expect(card.locator('[data-g="counter"]')).toHaveText(`0 of ${n1} found`);
    await shot(page, `p89-chat-start-${width}`);

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
    await shot(page, `p89-one-correct-${width}`);
  });
}

test('390px: an industry page opens with its first chat\'s rules on screen, no scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const slug of ['property', 'insurance', 'wealth', 'b2b', 'luxury', 'recruitment']) {
    await page.goto(`/game/${slug}/`);
    expect(await page.evaluate(() => scrollY), slug).toBe(0);
    await expect.poll(() => onScreen(page, '[data-g="rule"]'), { message: slug }).toBe(true);
    await expect.poll(() => onScreen(page, '[data-g="warn"]'), { message: slug }).toBe(true);
  }
});

test('NEGATIVE 1440px: opening an industry page never scrolls it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/game/property/');
  await expect(page.locator('[data-g="rule"]')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});
