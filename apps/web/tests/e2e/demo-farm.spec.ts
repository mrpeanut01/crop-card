import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';

const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;

async function expectNoOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
}

/** The production sign-in mode: the demo must work without direct login. */
test.describe('demo farm from the sign-in page', () => {
  test.use({ baseURL: MAGIC_BASE, viewport: { width: 375, height: 800 } });

  test('a visitor explores a seeded farm, resets it and leaves', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.getByTestId('demo-card')).toBeVisible();
    await page.getByTestId('demo-start').click();

    await page.waitForURL('**/today');
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expectNoOverflow(page);

    for (const path of [
      '/today?view=week',
      '/plan',
      '/records',
      '/inventory',
      '/equipment',
      '/animals',
      '/finance',
      '/harvest'
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(400);
      await expect(page.getByTestId('demo-banner')).toBeVisible();
    }

    await page.goto('/today');
    const farmCookie = (await page.context().cookies()).find((c) => c.name === 'cropcard.session');
    expect(farmCookie).toBeTruthy();

    page.once('dialog', (d) => d.accept());
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/demo?/reset')),
      page.getByTestId('demo-reset').click()
    ]);
    await page.waitForLoadState('load');
    const resetCookie = (await page.context().cookies()).find((c) => c.name === 'cropcard.session');
    expect(resetCookie?.value).not.toBe(farmCookie?.value);
    await expect(page.getByTestId('demo-banner')).toBeVisible();

    await page.getByTestId('demo-leave').click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.getByTestId('demo-card')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Start from scratch opens onboarding like a new user', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 39.137, longitude: -77.714 });

    await page.goto('/');
    await page.getByTestId('demo-start').click();
    await page.waitForURL('**/today');

    page.once('dialog', (d) => d.accept());
    await page.getByTestId('demo-scratch').click();
    await page.waitForURL('**/onboarding');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tell us about your farm');
    await expect(page.getByLabel('Farm name')).toHaveValue('');
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await page.goto('/today');
    await expect(page).toHaveURL(/\/onboarding$/);

    await page.getByLabel('Farm name').fill('Scratch Acres');
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByTestId('picked-location')).toContainText('39.1370, -77.7140');
    const cont = page.getByRole('button', { name: /^Continue/ });
    await expect(cont).toBeEnabled();
    await cont.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are you growing on?');
    await page.getByText('A garden', { exact: true }).click();
    await page.getByRole('button', { name: /Take me to Today/ }).click();
    await expect(page).toHaveURL(/\/today$/, { timeout: 15_000 });
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('getting-started')).toBeVisible();

    await page.getByTestId('demo-leave').click();
    await page.waitForURL((u) => u.pathname === '/');
    expect(errors).toEqual([]);
  });

  test('outward-facing settings refuse politely', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('demo-start').click();
    await page.waitForURL('**/today');
    const res = await page.request.post('/api/invites', {
      data: { email: 'someone@example.com', role: 'helper' },
      headers: { origin: MAGIC_BASE }
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'DEMO_DISABLED' });
  });
});
