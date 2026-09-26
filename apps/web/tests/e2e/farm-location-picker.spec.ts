import { test, expect } from './lib/test';
import { provisionWizardTenant } from './lib/wizardTenant';

// Settings → Farm details: the owner can fill latitude/longitude from a GPS
// fix (or a map pin) in a popup, then save as usual.

test.describe('farm location picker', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a GPS fix fills latitude and longitude and saves', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 39.123456, longitude: -77.654321 });
    await provisionWizardTenant(page, { blocks: [] });

    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('open-location-picker').click();

    const dialog = page.getByRole('dialog', { name: 'Find your farm on the map' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('gps-apply')).toBeDisabled();
    await dialog.getByTestId('gps-locate').click();
    await expect(dialog.getByTestId('gps-picked')).toHaveText(/GPS fix · 39\.1235, -77\.6543/);
    await dialog.getByTestId('gps-apply').click();
    await expect(dialog).toBeHidden();

    await expect(page.locator('input[name="lat"]')).toHaveValue('39.1235');
    await expect(page.locator('input[name="lon"]')).toHaveValue('-77.6543');

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.goto('/settings/farm');
    await expect(page.locator('input[name="lat"]')).toHaveValue('39.1235');
    await expect(page.locator('input[name="lon"]')).toHaveValue('-77.6543');
  });

  test('cancel leaves the typed coordinates alone', async ({ page }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    await page.locator('input[name="lat"]').fill('38.5');
    await page.locator('input[name="lon"]').fill('-78.25');

    await page.getByTestId('open-location-picker').click();
    const dialog = page.getByRole('dialog', { name: 'Find your farm on the map' });
    await expect(dialog.getByTestId('gps-picked')).toHaveText(/38\.5000, -78\.2500/);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('input[name="lat"]')).toHaveValue('38.5');
  });
});
