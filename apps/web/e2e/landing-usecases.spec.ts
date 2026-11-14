import { test, expect, type Page } from '@playwright/test';

/**
 * [P70 · owner] The rebuilt landing page in a real browser (this file was the P41-2 use-case grid check; the grid is
 * now the "Pick your world" tabs). At 390px: no sideways scroll, the tabs wrap, the chat wall shrinks, and the game is
 * played through all five chats by tapping, with "Why it counts" on every hit and every missed detail. Reduced motion
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

test('390px: play all five chats by tapping; "Why it counts" shows for every hit and every missed detail', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#game');
  const card = page.locator('[data-game]');
  // the detail messages in each chat, from landing-data.ts
  const SIGS = [[1, 3], [1, 4], [2, 4], [2, 4, 6], [2, 4, 6]];
  for (let r = 0; r < 5; r++) {
    await expect(card).toContainText(`CHAT ${r + 1}/5`);
    const msgs = card.locator('button.tv-msg');
    const sigs = SIGS[r]!;
    const chatter = [...Array(await msgs.count()).keys()].filter((i) => !sigs.includes(i));
    // tap the first detail (a hit), then chatter until the taps run out
    await msgs.nth(sigs[0]!).click();
    await expect(msgs.nth(sigs[0]!)).toHaveAttribute('aria-pressed', 'true');
    await expect(msgs.nth(sigs[0]!)).toContainText('Why it counts:');
    if (r === 0) await shot(page, 'p70-game-chat1-hit-390', { el: card });
    for (const i of chatter) {
      if (await card.locator('[data-act="next"]').count()) break;
      await msgs.nth(i).click();
      await expect(msgs.nth(i)).toContainText('Just chatter. Nothing here helps you close.');
      if (r === 0 && i === chatter[0]) await shot(page, 'p70-game-chat1-mid-390', { el: card });
    }
    await expect(card.locator('[aria-live="polite"]')).toContainText(`Tovira caught ${sigs.length} of ${sigs.length}.`);
    for (const i of sigs.slice(1)) {
      await expect(msgs.nth(i)).toContainText('You missed it:');
      await expect(msgs.nth(i)).toContainText('Why it counts:');
    }
    if (r === 4) await shot(page, 'p70-game-chat5-summary-390', { el: card });
    await card.locator('[data-act="next"]').click();
  }
  await expect(card).toContainText('YOUR SCORE');
  await expect(card).toContainText('5/12');
  await expect(card).toContainText('Like most busy reps.');
  await shot(page, 'p70-game-end-390', { el: card });
  await noSideScroll(page);
  await card.getByRole('button', { name: 'Play again' }).click();
  await expect(card).toContainText('CHAT 1/5 · EASY');
  await expect(card).toContainText('0 PTS');
});
