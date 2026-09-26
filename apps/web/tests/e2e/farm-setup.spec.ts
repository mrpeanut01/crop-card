import type { Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { provisionWizardTenant } from './lib/wizardTenant';

// A new farm's /plan asks "Where will this grow?". "Sketch it by size"
// opens "Draw your farm" (/plan/farm) in Dimensions mode, which sketches
// fields and blocks as boxes without any map tiles, then the page hands
// off to the planning wizard.

function sketch(page: Page) {
  return page.getByTestId('farm-sketch');
}

test.describe('draw your farm', () => {
  test.describe.configure({ timeout: 90_000 });

  test('a farm with no blocks is offered the farm page and sketches by dimensions', async ({
    page
  }) => {
    await provisionWizardTenant(page, { seasonSetup: true, blocks: [] });
    await page.goto('/plan');
    await expect(page.getByRole('heading', { name: 'Where will this grow?' })).toBeVisible();
    await page.getByRole('link', { name: /Sketch it by size/ }).click();
    await page.waitForURL(/\/plan\/farm\?mode=sketch$/);
    await expect(page.getByRole('heading', { name: 'Draw your farm', level: 1 })).toBeVisible();
    await expect(page.locator('.continue.disabled')).toBeVisible();
    await expect(page.getByRole('button', { name: /Dimensions/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    const fieldForm = page.getByTestId('sketch-add-field');
    await fieldForm.getByLabel('Field name').fill('Back Forty');
    await fieldForm.getByLabel('Width (ft)').fill('400');
    await fieldForm.getByLabel('Length (ft)').fill('300');
    await expect(fieldForm.getByText('≈ 2.75 ac')).toBeVisible();
    await fieldForm.getByRole('button', { name: 'Add field' }).click();
    await expect(sketch(page).locator('[data-field="Back Forty"] rect')).toBeVisible();

    const blockForm = page.getByTestId('sketch-add-block');
    // A new farm has no starter Area until onboarding screen 2 is answered,
    // so Back Forty is the only field and the picker only shows with two.
    await expect(blockForm.getByLabel('Field')).toHaveCount(0);
    await blockForm.getByLabel('Block name').fill('Sweet corn A');
    await blockForm.getByLabel('Width (ft)').fill('100');
    await blockForm.getByLabel('Length (ft)').fill('150');
    await blockForm.getByRole('button', { name: 'Add block' }).click();
    await expect(sketch(page).locator('[data-block="Sweet corn A"] rect')).toBeVisible();
    await expect(page.getByText('100 × 150 ft')).toBeVisible();

    await page.getByRole('link', { name: 'Continue to planning →' }).click();
    await page.waitForURL(/\/plan$/);
    await expect(page.locator('.aw-modal')).toBeVisible();
  });

  test('the map offers a center-on-me control that reports when location is unavailable', async ({
    page,
    context
  }) => {
    await provisionWizardTenant(page, { seasonSetup: true, blocks: [] });
    await context.clearPermissions();
    await page.goto('/plan/farm');
    const center = page.getByRole('button', { name: /Center on my location/ });
    await expect(center).toBeEnabled();
    await center.click();
    // Headless Chromium leaves the permission prompt unanswered, so this
    // lands on the 15s give-up message rather than an outright denial.
    await expect(page.getByRole('status').filter({ hasText: /location/i })).toBeVisible({
      timeout: 25_000
    });
  });

  test('a granted location centers the map without an error', async ({ page, context }) => {
    await provisionWizardTenant(page, { seasonSetup: true, blocks: [] });
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 39.0438, longitude: -77.4874 });
    await page.goto('/plan/farm');
    const center = page.getByRole('button', { name: /Center on my location/ });
    await expect(center).toBeEnabled();
    await center.click();
    await expect(center).toHaveText(/Center on my location/);
    await expect(page.locator('.locate-msg')).toHaveCount(0);
  });
});
