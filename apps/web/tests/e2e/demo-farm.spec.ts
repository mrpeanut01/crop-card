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
    await page.getByTestId('demo-reset').click();
    await page.waitForURL('**/today');
    const resetCookie = (await page.context().cookies()).find((c) => c.name === 'cropcard.session');
    expect(resetCookie?.value).not.toBe(farmCookie?.value);
    await expect(page.getByTestId('demo-banner')).toBeVisible();

    await page.getByTestId('demo-leave').click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.getByTestId('demo-card')).toBeVisible();
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
