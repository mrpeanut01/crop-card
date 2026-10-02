/**
 * /plan visual baselines at three viewports (Phase 33D, D-36): the workflow
 * strip, the Area rail, the selected Area with its Block cards, the block
 * header, planting cards, the season timeline and scheduled tasks on the
 * seeded demo farm. Names, dates, the season year and the today marker are
 * masked so the Linux baselines stay stable across days and seasons.
 */
import { test, expect, settleForScreenshot } from '../lib/test';
import { signInAsDemoOwner } from '../lib/auth';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 }
];

for (const vp of VIEWPORTS) {
  test(`plan at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/plan');
    await page.waitForLoadState('networkidle');
    // An empty planning season opens the wizard; the baseline is the page.
    if (await page.locator('.aw-modal').isVisible()) await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder('Filter Areas, beds or crops…')).toBeVisible();
    await expect(page.getByTestId('plan-area-view')).toBeVisible();

    await settleForScreenshot(page);
    await expect(page).toHaveScreenshot(`plan-${vp.name}.png`, {
      fullPage: true,
      mask: [
        // "Season <year> plan" moves with the planning year.
        page.locator('[role="group"][aria-label$="workflow"] .kicker'),
        // Area cards in the rail and the selected Area's Block cards.
        page.locator('[data-testid="plan-area-cards"] article'),
        page.locator('[data-testid="plan-area-view"] article'),
        // Block header: name, crop summary and harvest window pills.
        page.locator('.bh-left'),
        // Planting cards: variety, stage, planted and harvest dates.
        page.locator('article[data-card-kind="planting"]'),
        // Season timeline: year label, month axis with the today pin, rows.
        page.locator('.cap'),
        page.locator('.axis-row'),
        page.locator('.today-pin'),
        page.locator('.gantt-row'),
        // Scheduled tasks for the current window.
        page.locator('table tbody'),
        page.locator('.empty')
      ]
    });
  });
}
