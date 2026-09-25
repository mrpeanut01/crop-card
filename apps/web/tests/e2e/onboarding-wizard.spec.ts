import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function signInFresh(page: Page): Promise<void> {
  const email = `onboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
  const res = await page.request.post('/?/signin', {
    form: { email },
    headers: { 'x-sveltekit-action': 'true', origin: origin(page) },
    maxRedirects: 0
  });
  const body = (await res.json()) as { location?: string };
  expect(body.location).toBe('/onboarding');
}

async function createFarm(page: Page): Promise<void> {
  await page.goto('/onboarding');
  await page.waitForLoadState('networkidle');
  await page.getByLabel(/Farm name/).fill(`Setup Farm ${Date.now()}`);
  await page.getByRole('button', { name: /Create farm/ }).click();
  await expect(page).toHaveURL(/\/onboarding\?step=location$/);
}

test.describe('first-run setup wizard', () => {
  test('walks farm basics before opening season planning', async ({ page }) => {
    await signInFresh(page);
    await createFarm(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where is the farm?');

    // A new owner is sent back to the wizard until they finish it.
    await page.goto('/today');
    await expect(page).toHaveURL(/\/onboarding$/);

    // Season planning stays locked while basics are incomplete.
    await page.goto('/onboarding?step=season');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where is the farm?');

    await page.getByLabel('Latitude').fill('39.137');
    await page.getByLabel('Longitude').fill('-77.714');
    await page.getByRole('button', { name: /Save location and continue/ }).click();
    await expect(page).toHaveURL(/step=fields$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Draw your fields and blocks.'
    );
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeDisabled();

    const block = await page.request.post('/api/blocks', {
      data: { name: 'North Bed', acres: 0.25 },
      headers: { origin: origin(page) }
    });
    expect(block.ok()).toBe(true);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: /^Continue/ }).click();
    await expect(page).toHaveURL(/step=implements$/);
    await page.waitForLoadState('networkidle');

    await page.getByText('4 gal backpack sprayer (Solo / Birchmeier)').click();
    await expect(page.getByRole('status').filter({ hasText: '1 to add' })).toBeVisible();
    await page.getByRole('button', { name: /Save implements and continue/ }).click();
    await expect(page).toHaveURL(/step=season$/);
    await expect(page.getByText('Farm basics are done.')).toBeVisible();

    const eq = await page.request.get('/api/equipment?type=sprayer');
    const { equipment } = (await eq.json()) as {
      equipment: Array<{ label: string; state: { calibratedGpa?: number } }>;
    };
    expect(equipment.map((e) => e.label)).toEqual(['4 gal backpack sprayer (Solo / Birchmeier)']);
    expect(equipment[0].state.calibratedGpa).toBeUndefined();

    await page.getByRole('button', { name: /Save & continue/ }).click();
    await expect(page).toHaveURL(/step=plan$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your farm is set up.');
    await expect(page.locator('p', { hasText: /1\s+sprayer needs calibrating/ })).toBeVisible();

    await page.getByRole('button', { name: /Open the season planner/ }).click();
    await expect(page).toHaveURL(/\/plan$/);
    await expect(page.getByRole('dialog').first()).toBeVisible();

    await page.goto('/today');
    await expect(page).toHaveURL(/\/today$/);
  });

  test('"finish later" lets the owner reach Today with a way back', async ({ page }) => {
    await signInFresh(page);
    await createFarm(page);
    await page.getByRole('button', { name: 'Finish setup later' }).click();
    await expect(page).toHaveURL(/\/today$/);
    await page.getByRole('link', { name: /Resume the setup guide/ }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where is the farm?');
  });
});
