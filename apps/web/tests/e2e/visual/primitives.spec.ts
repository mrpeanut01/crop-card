import { expect, test } from '@playwright/test';

/**
 * Phase 25a visual baseline for the Almanac primitive component library.
 * Renders /_dev/primitives at three viewports and screenshots it.
 *
 * Auth: /_dev/primitives is gated to dev || superadmin || ENABLE_DEV_ROUTES=1.
 * playwright.config.ts sets ENABLE_DEV_ROUTES=1 on the preview server.
 *
 * Baseline updates: run `pnpm test:e2e --update-snapshots` and inspect the
 * diff before committing the new PNGs.
 */

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 }
];

for (const vp of VIEWPORTS) {
  test(`primitives page renders at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/_dev/primitives');
    // Wait for fonts so the screenshot isn't captured mid-FOUT.
    await page.evaluate(async () => {
      if ('fonts' in document) await (document as Document).fonts.ready;
    });
    // Smoke: every primitive section heading is present.
    await expect(page.getByRole('heading', { name: 'Pill — 5 tones' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Button' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Form fields' })).toBeVisible();
    // Visual baseline.
    await expect(page).toHaveScreenshot(`primitives-${vp.name}.png`, {
      fullPage: true,
      // Mask any element with timestamp-like content if we add it later.
      animations: 'disabled'
    });
  });
}
