/**
 * Phase 25b (#81) — Plan v2 Almanac shell visual baselines.
 *
 * Captures the rebuilt /plan page (left rail + block header +
 * plantings grid + season timeline + scheduled tasks) at 3 viewports.
 * Auth via the Phase 25b demo-sign-in helper; live data (block name,
 * planting metadata, harvest dates) is masked so baselines stay
 * deterministic across days.
 */
import { test, expect, settleForScreenshot } from '../lib/test';
import { signInAsDemoOwner } from '../lib/auth';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 }
];

for (const vp of VIEWPORTS) {
  test(`plan v2 Almanac shell at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/plan');
    await page.waitForLoadState('networkidle');
    // An empty planning season opens the wizard; the baseline is the shell.
    if (await page.locator('.aw-modal').isVisible()) await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder('Filter Areas, beds or crops…')).toBeVisible();

    await settleForScreenshot(page);
    await expect(page).toHaveScreenshot(`plan-${vp.name}.png`, {
      fullPage: true,
      mask: [
        // Area card rail (names + crops vary by seed).
        page.locator('[data-testid="plan-area-cards"] article'),
        // Area card and Block cards over the selected block.
        page.locator('[data-testid="plan-area-view"] article'),
        // Block header title (block name + crop summary vary).
        page.locator('.bh-left'),
        // Planting cards' inner content (variety, dates, amount, status).
        page.locator('article[data-card-kind="planting"] .body'),
        // Season timeline rows (vary with current date + plantings).
        page.locator('.gantt-row'),
        // Scheduled-tasks rows.
        page.locator('table tbody')
        // Legacy details summary (stable so don't mask).
      ]
    });
  });
}
