import { test, expect, type Page } from '@playwright/test';

/**
 * [P70 · owner] The rebuilt landing page in a real browser (this file was the P41-2 use-case grid check; the grid is
 * now the "Pick your world" tabs). At 390px: no sideways scroll, the tabs wrap, the chat wall shrinks, and the game is
 * played by tapping (P71: pick an industry, a perfect chat, a failed chat's reveal and lock, the end screen). Reduced motion
 * stops every animation. With SHOTS_DIR set, each screen is saved there (for review; not committed).
 */
async function shot(page: Page, name: string, opts: { full?: boolean; el?: ReturnType<Page['locator']> } = {}): Promise<void> {
  if (!process.env.SHOTS_DIR) return;
  const path = `${process.env.SHOTS_DIR}/${name}.png`;
  if (opts.el) await opts.el.screenshot({ path });
  else await page.screenshot({ path, fullPage: opts.full ?? false });
}
const noSideScroll = async (page: Page) => {
  const { scrollW, clientW } = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
  expect(scrollW).toBeLessThanOrEqual(clientW);
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/visit', (r) => r.fulfill({ status: 204, body: '' }));
});

test('390px: no sideways scroll, hero stacks with the game under the CTAs, tabs wrap, wall is about 360px', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await noSideScroll(page);
  const cta = await page.locator('#top a.tv-cta').first().boundingBox();
  const game = await page.locator('#game').boundingBox();
  expect(game!.y).toBeGreaterThan(cta!.y);
  expect(await page.locator('.tv-navlink').first().isVisible()).toBe(false);
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
  const tabs = await page.getByRole('tab').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(new Set(tabs.map(Math.round)).size).toBeGreaterThan(1); // wrapped onto more than one row
  expect(Math.round((await page.locator('.tv-wall').boundingBox())!.height)).toBe(360);
  await shot(page, 'p70-full-390', { full: true });
  for (let i = 0; i < 6; i++) {
    await page.getByRole('tab').nth(i).click();
    await expect(page.getByRole('tab').nth(i)).toHaveAttribute('aria-selected', 'true');
    await noSideScroll(page);
    await shot(page, `p70-tab-${i + 1}-390`, { el: page.locator('#worlds') });
  }
});

test('1440px: the game sits beside the headline', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const h1 = await page.locator('h1').boundingBox();
  const game = await page.locator('#game').boundingBox();
  expect(game!.x).toBeGreaterThan(h1!.x + h1!.width - 1);
  expect(game!.y).toBeLessThan(h1!.y + h1!.height);
  await noSideScroll(page);
  await shot(page, 'p70-hero-1440');
  await shot(page, 'p70-full-1440', { full: true });
});

test('the tabs work from the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Property' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Insurance' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Insurance' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('Travels to Europe most months.');
  await page.keyboard.press('End');
  await expect(page.getByRole('tabpanel')).toContainText('Wants hybrid. Three office days at most.');
});

test('reduced motion: nothing is animating', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForTimeout(300);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  expect(running).toBe(0);
  expect(await page.locator('.tv-star').first().evaluate((el) => getComputedStyle(el).opacity)).toBe('0.5');
});

// [P71 · owner] The pick-your-industry game: pick Property, play chat 1 perfectly, fail chat 2 on purpose (the reveal and
// the lock), finish, then Try another industry. Property's details, from landing-data.ts: chat 1 [1], chat 2 [1, 3].
for (const width of [390, 1440]) {
  test(`${width}px: pick Property, a perfect chat, a failed chat reveals and locks, the end screen, try another`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/#game');
    const card = page.locator('[data-game]');
    await expect(card.getByRole('button')).toHaveCount(6);
    await shot(page, `p71-pick-${width}`, { el: card });
    await card.getByRole('button', { name: 'Property' }).click();
    await expect(card).toContainText('Property client · chat 1 of 5');
    const msgs = card.locator('button.tv-msg');
    await msgs.nth(1).click();
    await expect(msgs.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(msgs.nth(1)).toContainText('+1 · Needs 3+ bedrooms');
    await expect(msgs.nth(1)).toContainText('Why it counts:');
    await shot(page, `p71-correct-tap-${width}`, { el: card });
    await expect(card.locator('[aria-live="polite"]')).toContainText('You caught it.');
    for (const i of [0, 2, 3]) { await expect(msgs.nth(i)).toContainText('Chatter'); await expect(msgs.nth(i)).toBeDisabled(); }
    await card.locator('[data-act="next"]').click();
    await expect(card).toContainText('Property client · chat 2 of 5');
    await msgs.nth(2).click(); // "haha yes": chatter ends the chat
    await expect(msgs.nth(2)).toContainText('Your tap: just chatter. That ended this chat.');
    for (const i of [1, 3]) { await expect(msgs.nth(i)).toContainText('You missed it:'); await expect(msgs.nth(i)).toContainText('Why it counts:'); }
    await expect(msgs.nth(0)).toContainText('Chatter');
    for (let i = 0; i < 5; i++) await expect(msgs.nth(i)).toBeDisabled();
    await expect(card.locator('[aria-live="polite"]')).toContainText('You missed both.');
    await expect(card.locator('[aria-live="polite"]')).toContainText('This chat had 2 useful details. Tovira caught all 2, each linked to the message it came from.');
    await shot(page, `p71-wrong-tap-reveal-${width}`, { el: card });
    for (let r = 2; r < 5; r++) {
      await card.locator('[data-act="next"]').click();
      await expect(card).toContainText(`chat ${r + 1} of 5`);
      await msgs.nth(0).click(); // every Property chat opens with chatter
    }
    await expect(card.locator('[data-act="next"]')).toHaveText('See your score');
    await card.locator('[data-act="next"]').click();
    await expect(card).toContainText('YOUR SCORE · PROPERTY');
    await expect(card).toContainText('1/12');
    await expect(card).toContainText('Like most busy reps.');
    await shot(page, `p71-end-${width}`, { el: card });
    await noSideScroll(page);
    await card.getByRole('button', { name: 'Try another industry' }).click();
    await expect(card.locator('[data-act="start"]')).toHaveCount(6);
  });
}
