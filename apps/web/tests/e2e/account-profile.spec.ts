import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';

const PNG_4X4 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGM4UaEBRwzEcQBTUhaBGaoOzwAAAABJRU5ErkJggg==',
  'base64'
);

/** A fresh user with their own farm, so changing units or the name here
 *  never leaks into specs running in parallel as the shared demo owner. */
async function signInWithOwnFarm(page: Page): Promise<void> {
  const origin = new URL(test.info().project.use.baseURL ?? 'http://localhost:5173').origin;
  const headers = { 'x-sveltekit-action': 'true', origin };
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const signin = await page.request.post('/?/signin', {
    form: { email: `profile-${tag}@e2e.cropcard.local` },
    headers,
    maxRedirects: 0
  });
  expect(((await signin.json()) as { location?: string }).location).toBe('/onboarding');
  const farm = await page.request.post('/onboarding?/farm', {
    form: { farmName: `Profile Farm ${tag}` },
    headers,
    maxRedirects: 0
  });
  expect(((await farm.json()) as { type?: string }).type).toBe('redirect');
}

async function save(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/settings/account')
    ),
    page.getByRole('button', { name: 'Save changes' }).click()
  ]);
  await expect(page.getByText('Profile saved.')).toBeVisible();
  // The action re-renders the page; wait for hydration so the next edit
  // isn't reset to the server-rendered value.
  await page.waitForLoadState('networkidle');
}

test.describe('/settings/account profile', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await signInWithOwnFarm(page);
  });

  test('changes the display name and shows it in the top bar', async ({ page }) => {
    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    const name = page.getByRole('textbox', { name: /display name/i });
    await name.fill('  Dale   Ridge ');
    await save(page);
    await expect(name).toHaveValue('Dale Ridge');
    await expect(page.locator('header.topbar .standalone')).toHaveAttribute('title', 'Dale Ridge');

    await name.fill('');
    await save(page);
    await expect(page.locator('header.topbar .standalone')).not.toHaveAttribute(
      'title',
      'Dale Ridge'
    );
  });

  test('saves time zone and display units', async ({ page }) => {
    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    const tz = page.getByRole('combobox', { name: /time zone/i });
    const units = page.getByRole('combobox', { name: /display units/i });
    await expect(tz).toHaveValue('America/New_York');
    await expect(units).toHaveValue('us');

    await tz.selectOption('America/Chicago');
    await units.selectOption('metric');
    await save(page);

    await page.reload();
    await expect(tz).toHaveValue('America/Chicago');
    await expect(units).toHaveValue('metric');
    await expect(page.getByLabel(/last sign-in/i)).toHaveValue(/C[SD]T$/);

    await tz.selectOption('America/New_York');
    await units.selectOption('us');
    await save(page);
  });

  test('uploads, displays and removes a profile picture', async ({ page }) => {
    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    await page.locator('#avatar-file').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: PNG_4X4
    });
    await expect(page.getByText('Picture updated.')).toBeVisible();

    const topbarImg = page.locator('header.topbar img');
    await expect(topbarImg).toHaveAttribute('src', /^\/api\/account\/avatar\/.+\?v=\d+$/);
    const src = await topbarImg.getAttribute('src');
    const res = await page.request.get(src!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/jpeg');

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Picture removed.')).toBeVisible();
    await expect(topbarImg).toHaveCount(0);
    expect((await page.request.get(src!)).status()).toBe(404);
  });

  test('refuses a file that is not a picture', async ({ page }) => {
    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    const res = await page.request.post('/api/account/avatar', {
      headers: { origin: new URL(page.url()).origin, 'content-type': 'image/svg+xml' },
      data: '<svg xmlns="http://www.w3.org/2000/svg"/>'
    });
    expect(res.status()).toBe(415);
  });
});
