import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';

// Phase 33C C1: the shipped library with forageHazards, manureCarryoverDays
// and hayOffFarmRestricted loads in the running app, and every changed
// plugin still opens in the catalog.

test.describe('Phase 33C plugin data', () => {
  test('the forage crops and carryover herbicides load and open in the catalog', async ({
    page
  }) => {
    await provisionEmptyFarm(page);

    const res = await page.request.get('/api/plugins');
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      crops: Array<{ pluginId: string }>;
      herbicides: Array<{ pluginId: string }>;
    };
    const crops = new Set(body.crops.map((c) => c.pluginId));
    for (const id of ['sorghum-sudangrass-cover', 'corn', 'oats-cover-spring', 'alfalfa-vernema']) {
      expect(crops.has(id), id).toBe(true);
    }
    const herbicides = new Set(body.herbicides.map((h) => h.pluginId));
    for (const id of [
      'grazonnext-hl',
      'duracor-aminopyralid-florpyrauxifen',
      'chaparral-aminopyralid-metsulfuron',
      'crossbow',
      'stinger'
    ]) {
      expect(herbicides.has(id), id).toBe(true);
    }

    await page.goto('/inventory/crop/sorghum-sudangrass-cover');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Sorghum-Sudangrass (warm-season cover)').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });
});
