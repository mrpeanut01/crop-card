import type { Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { provisionWizardTenant } from './lib/wizardTenant';

// Hardiness zone: an estimate from the nearest NOAA station's 1991-2020
// average coldest night, shown read-only with its station and never called
// the USDA map; the owner can type their own, which becomes `manual`.

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
    const res = await page.request.post('/api/settings', {
      data: { key: 'farm_lat_lon', value: { lat: 38.9408, lon: -77.4636 } },
      headers: { origin: origin(page) }
    });
    expect(res.ok(), await res.text()).toBe(true);

    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    const chip = page.getByTestId('zone-chip');
    await expect(chip.getByTestId('zone-value')).toHaveText('Zone 7a (approx.)');
    const estimate = chip.locator('[data-provenance="data"]');
    await expect(estimate).toHaveAttribute('aria-label', /Dulles/);

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
});
