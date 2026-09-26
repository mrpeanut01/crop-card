import { test, expect } from './lib/test';
import { provisionWizardTenant } from './lib/wizardTenant';

// Sprint 30H: emergency contacts are set on /settings/farm and printed at
// the top of the Farm Map Card.

test.describe('emergency contacts', () => {
  test.describe.configure({ timeout: 120_000 });

  test('Poison Control in one tap, a vet by hand, both on the Farm Map Card', async ({ page }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Add Poison Control (1-800-222-1222)' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect(page.getByLabel('Contact 1 phone')).toHaveValue('1-800-222-1222');
    await expect(
      page.getByRole('button', { name: 'Add Poison Control (1-800-222-1222)' })
    ).toHaveCount(0);

    await page.waitForLoadState('networkidle');
    await expect(async () => {
      await page.getByRole('button', { name: 'Add a contact' }).click();
      await expect(page.getByLabel('Contact 2 name')).toBeVisible({ timeout: 1000 });
    }).toPass();
    await page.getByLabel('Contact 2 name').fill('Dr. Reyes');
    await page.getByLabel('Contact 2 role').fill('Vet');
    await page.getByLabel('Contact 2 phone').fill('540-555-0101');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect(page.getByLabel('Contact 2 name')).toHaveValue('Dr. Reyes');

    await page.getByLabel('Contact 2 phone').fill('soon');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('alert')).toContainText('Contact 2:');
    await expect(page.getByLabel('Contact 2 phone')).toHaveValue('soon');

    await page.goto('/plan/farm-map');
    await page.waitForLoadState('networkidle');
    const onScreen = page.locator('.no-print');
    await expect(onScreen.getByText('Emergency contacts').first()).toBeVisible();
    await expect(
      onScreen.getByText('Poison Control (Poisoning or chemical exposure): 1-800-222-1222')
    ).toBeVisible();
    await expect(onScreen.getByText('Dr. Reyes (Vet): 540-555-0101')).toBeVisible();

    await page.emulateMedia({ media: 'print' });
    await expect(
      page.getByText('Poison Control (Poisoning or chemical exposure): 1-800-222-1222').last()
    ).toBeVisible();
  });

  test('the section fits a 375px phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await provisionWizardTenant(page, { blocks: [] });
    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Add a contact' }).click();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
    const box = await page.getByRole('button', { name: 'Remove contact 1' }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  });
});
