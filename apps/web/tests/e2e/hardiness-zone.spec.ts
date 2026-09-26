import type { Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { provisionWizardTenant } from './lib/wizardTenant';

// Hardiness zone: an estimate from the nearest NOAA station's 1991-2020
// average coldest night, shown read-only with its station and never called
// the USDA map; the owner can type their own, which becomes `manual`. With
// no station within 50 mi, a farm of known elevation gets a wider pass (to
// 100 mi, similar elevation only) shown with its distance.

function stubElevation(page: Page, elevationFt: number | null) {
  return page.route('**/api/climate/elevation**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ elevationFt, source: elevationFt === null ? null : 'USGS 3DEP' })
    })
  );
}

async function setFarm(page: Page, lat: number, lon: number) {
  const res = await page.request.post('/api/settings', {
    data: { key: 'farm_lat_lon', value: { lat, lon } },
    headers: { origin: origin(page) }
  });
  expect(res.ok(), await res.text()).toBe(true);
}

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

test.describe('hardiness zone', () => {
  test.describe.configure({ timeout: 120_000 });

  test('estimates the zone from the farm location, and the owner can override it', async ({
    page
  }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await stubElevation(page, 289.4);
    await setFarm(page, 38.9408, -77.4636);

    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    const chip = page.getByTestId('zone-chip');
    await expect(chip.getByTestId('zone-value')).toHaveText('Zone 7a (approx.)');
    const estimate = chip.locator('[data-provenance="data"]');
    await expect(estimate).toHaveAttribute('aria-label', /Dulles/);
    await expect(chip.getByTestId('zone-reach')).toHaveCount(0);

    await chip.getByTestId('zone-input').fill('zone 9');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Enter a zone like 7a or 6b, or leave it blank.')).toBeVisible();

    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('zone-input').fill('6B');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('zone-value')).toHaveText('Zone 6b');
    await expect(page.getByTestId('zone-chip').locator('[data-provenance="manual"]')).toBeVisible();
    await expect(page.getByTestId('zone-chip')).toContainText('Station estimate: zone 7a');

    await page.goto('/plan/farm-map');
    const card = page.locator('article[data-card-kind="farmMap"][data-variant="screen"]');
    await expect(card.getByText('Zone', { exact: true })).toBeVisible();
    await expect(card.getByText('6b', { exact: true })).toBeVisible();

    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('zone-input').fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('zone-value')).toHaveText('Zone 7a (approx.)');
  });

  test('reaches out to 100 miles at a similar elevation, and says so', async ({ page }) => {
    // Snake Valley, NV: nothing with enough winters within 50 mi; USGS puts it at 6,919 ft.
    await provisionWizardTenant(page, { blocks: [] });
    await setFarm(page, 38, -114);

    await stubElevation(page, 6919.1);
    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    const chip = page.getByTestId('zone-chip');
    await expect(chip.getByTestId('zone-value')).toHaveText('Zone 6b (approx.)');
    await expect(chip.getByTestId('zone-reach')).toHaveText(
      '· nearest station 71 mi, similar elevation'
    );
    const estimate = chip.locator('[data-provenance="data"]');
    await expect(estimate).toHaveAttribute('aria-label', /Great Basin/);
    await expect(chip).toContainText('not the USDA map');

    await page.unroute('**/api/climate/elevation**');
    await stubElevation(page, null);
    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('zone-none')).toHaveText(
      'No station with enough winters within 50 mi.'
    );
    await expect(page.getByTestId('zone-value')).toHaveCount(0);
  });
});
