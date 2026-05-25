/**
 * Phase 25b (#81) — Plan v2 Almanac shell visual baselines.
 *
 * Captures the rebuilt /plan page (left rail + block header +
 * plantings grid + season timeline + scheduled tasks) at 3 viewports.
 * Auth via the Phase 25b demo-sign-in helper; live data (block name,
 * planting metadata, harvest dates) is masked so baselines stay
 * deterministic across days.
 */
import { test, expect } from '@playwright/test';
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
    await expect(page.getByPlaceholder('Filter blocks…')).toBeVisible();

    await expect(page).toHaveScreenshot(`plan-${vp.name}.png`, {
      fullPage: true,
      mask: [
        // Block list rail rows (names + plantings counts vary by seed).
        page.locator('.row .body'),
        // Block header title (block name + crop summary vary).
        page.locator('.bh-left'),
        // Planting cards' inner content (variety, dates, area, status).
        page.locator('.pc-body'),
        // Season timeline rows (vary with current date + plantings).
        page.locator('.gantt-row'),
        // Scheduled-tasks rows.
        page.locator('table tbody'),
        // Legacy details summary (stable so don't mask).
      ],
      maxDiffPixelRatio: 0.01
    });
  });
}
