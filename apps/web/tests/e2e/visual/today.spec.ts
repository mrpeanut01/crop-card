/**
 * Phase 25e (#97) — /today Almanac shell visual baselines.
 *
 * Captures the rebuilt /today page at 3 viewports. Auth via the
 * Phase 25b demo-sign-in helper; live data (priority action title,
 * date kicker, weather strip, season-glance counters) is masked so
 * baselines stay deterministic across days.
 */
import { test, expect } from '@playwright/test';
import { signInAsDemoOwner } from '../lib/auth';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 }
];

for (const vp of VIEWPORTS) {
  test(`today Almanac shell at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    // Wait for at least one shell element so we don't snapshot a partial render.
    await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();

    await expect(page).toHaveScreenshot(`today-${vp.name}.png`, {
      fullPage: true,
      mask: [
        // Greeting includes time-of-day ("Good morning/afternoon/evening").
        page.locator('h1.serif').first(),
        // Date kicker.
        page.locator('header.hdr [class^="kicker"]').first(),
        // Weather strip (varies with NOAA fetch).
        page.locator('header.hdr .weather'),
        // Hero card pills + provenance row (priority action depends on seed time).
        page.locator('.hero-head'),
        page.locator('.action-title'),
        page.locator('.action-body'),
        page.locator('.scope-band'),
        // Week strip changes every day.
        page.locator('.day'),
        // Recommendations card items change daily.
        page.locator('.item'),
        // Season-glance counters depend on registered plugins / season data.
        page.locator('.cell')
      ],
      maxDiffPixelRatio: 0.01
    });
  });
}
