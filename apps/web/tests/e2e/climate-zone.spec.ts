import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

const DULLES: [number, number] = [38.9408, -77.4636];

test.describe('hardiness zone and year-crossing frost seasons', () => {
  test.describe.configure({ timeout: 90_000 });

  test('settings shows the approximate zone and saves an owner override', async ({ page }) => {
    await signInNewUser(page, 'zone');
    await createOnboardedFarm(page, { growing: ['garden'], latLon: DULLES });

    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    const chip = page.getByTestId('hardiness-zone');
    await expect(chip).toContainText('Zone 7a (approx., from Washington DC Dulles AP, VA)');
    await expect(chip.locator('[data-provenance="data"]')).toBeVisible();
    await expect(page.getByText(/not the USDA map/)).toBeVisible();

    await page.getByText('Change zone', { exact: true }).click();
    const select = page.getByLabel('Your zone');
    await expect(select).toHaveValue('');
    await expect(select.locator('option').first()).toHaveText(/Use the station estimate \(7a\)/);
    await select.selectOption('6b');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

    await page.goto('/settings/farm');
    await expect(chip).toContainText('Zone 6b (your setting)');
    await expect(chip.locator('[data-provenance="manual"]')).toBeVisible();

    await page.goto('/plan/farm-map');
    await expect(page.getByText('6b (your setting)').first()).toBeVisible();

    await page.goto('/settings/farm');
    await page.getByLabel('Your zone').selectOption('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await page.goto('/settings/farm');
    await expect(chip).toContainText('Zone 7a (approx.');
  });

  test('the zone chip stays hidden with no station nearby', async ({ page }) => {
    await signInNewUser(page, 'nozone');
    const farm = await page.request.post('/onboarding?/farm', {
      form: { farmName: 'Island Farm', lat: '30', lon: '-45', frostConfirm: '1' },
      headers: { 'x-sveltekit-action': 'true', origin: originOf(page) },
      maxRedirects: 0
    });
    expect(((await farm.json()) as { type?: string }).type).toBe('redirect');
    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('hardiness-zone')).toHaveCount(0);
    await expect(page.getByText('Set your zone', { exact: true })).toBeVisible();
  });

  test('a Gulf-coast farm saves its frost dates without a confirm step', async ({ page }) => {
    await signInNewUser(page, 'gulf');
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Farm name').fill('Dauphin Island Garden');
    await page.getByText('Type the coordinates instead').click();
    await page.getByLabel('Latitude').fill('30.2506');
    await page.getByLabel('Longitude').fill('-88.0775');

    const frost = page.locator('section[aria-labelledby="frost-title"]');
    await expect(page.getByTestId('frost-lastFrost')).toHaveText('Jan 31');
    await expect(page.getByTestId('frost-firstFrost')).toHaveText('Jan 6');
    await expect(frost.getByTestId('frost-crosses-year')).toBeVisible();
    await expect(frost.getByLabel('These dates are fine for now')).toHaveCount(0);

    const cont = page.getByRole('button', { name: /^Continue/ });
    await expect(cont).toBeEnabled();
    await cont.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are you growing on?');

    const res = await page.request.post('/api/plan/planting-window', {
      data: { cropPluginId: 'tomato-celebrity-f1', year: 2027 }
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      window: { earliest: string; latest: string };
      provenance: string;
    };
    expect(body.provenance).toBe('fallback');
    expect(body.window.earliest < body.window.latest).toBe(true);
    expect(body.window.latest.startsWith('2027-')).toBe(true);
  });

  test('settings farm fits a 375px phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInNewUser(page, 'zonephone');
    await createOnboardedFarm(page, { growing: ['garden'], latLon: DULLES });
    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    await page.getByText('Change zone', { exact: true }).click();
    const chip = page.getByTestId('hardiness-zone');
    await expect(chip).toBeVisible();
    const chipBox = (await chip.boundingBox())!;
    const provBox = (await chip.locator('[data-provenance]').boundingBox())!;
    expect(provBox.x + provBox.width).toBeLessThanOrEqual(chipBox.x + chipBox.width + 1);
    expect(provBox.x + provBox.width).toBeLessThanOrEqual(375 - 16);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const summary = page.locator('.zone-edit summary');
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    expect((await page.getByLabel('Your zone').boundingBox())!.height).toBeGreaterThanOrEqual(48);
  });
});
