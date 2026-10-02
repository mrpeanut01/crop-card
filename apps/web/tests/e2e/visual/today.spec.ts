/**
 * /today visual baselines at three viewports (Phase 33D, D-36). The default
 * Day view of the seeded demo farm. Everything that moves with the date, the
 * weather or the seed time is masked, so the Linux baselines that visual.yml
 * re-captures stay stable from day to day.
 */
import { test, expect, settleForScreenshot } from '../lib/test';
import { signInAsDemoOwner } from '../lib/auth';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 }
];

for (const vp of VIEWPORTS) {
  test(`today at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('today-deck')).toBeVisible();
    await expect(page.getByTestId('today-deck')).toHaveAttribute('data-view', 'day');

    await settleForScreenshot(page);
    await expect(page).toHaveScreenshot(`today-${vp.name}.png`, {
      fullPage: true,
      mask: [
        // Date kicker, time-of-day greeting and the day's subtitle.
        page.locator('header.hdr [class^="kicker"]'),
        page.locator('header.hdr h1.greeting'),
        page.locator('header.hdr .subtitle'),
        // Current conditions (NWS).
        page.locator('header.hdr .weather'),
        // Hero: the next action, or "All caught up", depends on the clock.
        page.locator('.hero'),
        // Growing advice reads the weather and the day.
        page.getByTestId('today-advice'),
        // Deck: the day's cards, or the empty state, and its summary.
        page.locator('[data-testid="today-deck"] ul.cards'),
        page.getByTestId('deck-empty'),
        page.getByTestId('deck-empty-mine'),
        page.getByTestId('deck-summary'),
        // Crop calendar suggestions carry dates.
        page.locator('.suggestion'),
        // Recommendations and season-at-a-glance counters.
        page.locator('.item'),
        page.locator('.cell')
      ]
    });
  });
}
