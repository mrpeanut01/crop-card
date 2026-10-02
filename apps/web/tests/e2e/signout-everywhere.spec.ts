import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';

const OWNER_KEY = 'cropcard.activeOwnerId';

function originOf(): string {
  return new URL(test.info().project.use.baseURL ?? 'http://localhost:5173').origin;
}

async function signIn(page: Page, email: string): Promise<string | undefined> {
  const res = await page.request.post('/?/signin', {
    form: { email },
    headers: { 'x-sveltekit-action': 'true', origin: originOf() },
    maxRedirects: 0
  });
  return ((await res.json()) as { location?: string }).location;
}

/** Stands in for the tenant pointer the layout clears when it wipes the
 *  offline caches on a signed-out load. */
async function plantOwnerPointer(page: Page): Promise<void> {
  await page.evaluate((key) => sessionStorage.setItem(key, 'owner_marker'), OWNER_KEY);
}

const ownerPointer = (page: Page) => page.evaluate((key) => sessionStorage.getItem(key), OWNER_KEY);

test('Sign out everywhere signs out the other browser too', async ({ page, browser }) => {
  const email = `everywhere-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
  expect(await signIn(page, email)).toBe('/onboarding');
  const farm = await page.request.post('/onboarding?/farm', {
    form: { farmName: 'Everywhere Farm' },
    headers: { 'x-sveltekit-action': 'true', origin: originOf() },
    maxRedirects: 0
  });
  expect(((await farm.json()) as { type?: string }).type).toBe('redirect');

  const otherContext = await browser.newContext({
    baseURL: originOf(),
    serviceWorkers: 'block'
  });
  const other = await otherContext.newPage();
  try {
    expect(await signIn(other, email)).toBe('/today');
    await other.goto('/settings/account');
    await expect(other).toHaveURL(/\/settings\/account$/);
    expect((await other.request.get('/api/ai/usage')).status()).toBe(200);

    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Signed in on this browser')).toBeVisible();
    await plantOwnerPointer(page);
    await page.getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(page).toHaveURL(new URL('/', originOf()).href);
    await expect.poll(() => ownerPointer(page)).toBeNull();

    await page.goto('/today');
    await expect(page).toHaveURL(new URL('/', originOf()).href);

    await plantOwnerPointer(other);
    await other.goto('/today');
    await expect(other).toHaveURL(new URL('/', originOf()).href);
    await expect.poll(() => ownerPointer(other)).toBeNull();
    expect((await other.request.get('/api/ai/usage')).status()).toBe(401);

    expect(await signIn(other, email)).toBe('/today');
    await other.goto('/settings/account');
    await expect(other).toHaveURL(/\/settings\/account$/);
  } finally {
    await otherContext.close();
  }
});
