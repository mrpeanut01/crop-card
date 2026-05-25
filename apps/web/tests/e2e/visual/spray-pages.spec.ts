import { expect, test } from '@playwright/test';
import { signInAsDemoOwner } from '../lib/auth';

/**
 * Phase 25b (#86) — visual baseline for the three Spray pages.
 *
 * Renders /spray (herbicide), /spray/insecticide, and /spray/fungicide
 * at mobile / tablet / desktop after the demo owner signs in. The seed
 * script in playwright.config.ts' webServer chain creates the owner +
 * blocks + plantings the pages need to render their pickers.
 *
 * Baseline updates: run `pnpm test:e2e --update-snapshots` and inspect
 * the diff before committing the new PNGs. Same pixelmatch tolerance
 * (0.5%) as the primitives baseline.
 *
 * Why the time-stable masks: ConditionsCard + LayoutEngine render the
 * current date / wind / weather in places, which would make baselines
 * flaky day-to-day. We mask the date elements (data-test="now") and
 * any element whose text-content matches the live-weather pattern.
 * Any new live-data element added later should pick up the data-test
 * attribute so the mask catches it without spec changes.
 */

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 }
];

const ROUTES = [
  { name: 'herbicide', path: '/spray' },
  { name: 'insecticide', path: '/spray/insecticide' },
  { name: 'fungicide', path: '/spray/fungicide' }
];

for (const route of ROUTES) {
  for (const vp of VIEWPORTS) {
    test(`${route.name} spray page at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Sign in BEFORE setting viewport-conditional content loads.
      await signInAsDemoOwner(page);
      await page.goto(route.path);
      // Wait for fonts so the screenshot isn't captured mid-FOUT.
      await page.evaluate(async () => {
        if ('fonts' in document) await (document as Document).fonts.ready;
      });
      // Smoke: the page header rendered (h1 specific to the spray chemistry).
      // /spray (herbicide) uses "Spray" as the h1; insect/fung share the
      // SprayDecisionPage shell which prints a more specific title.
      await expect(page.locator('h1').first()).toBeVisible();
      // Visual baseline. Mask any element marked as live-data so timestamps
      // / weather don't make the baseline flaky.
      await expect(page).toHaveScreenshot(`spray-${route.name}-${vp.name}.png`, {
        fullPage: true,
        animations: 'disabled',
        mask: [page.locator('[data-test="now"], [data-live="weather"], time')]
      });
    });
  }
}
