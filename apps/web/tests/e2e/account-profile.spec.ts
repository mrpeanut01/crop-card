import { expect, test } from './lib/test';
import { signInAsDemoOwner } from './lib/auth';

const PNG_4X4 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGM4UaEBRwzEcQBTUhaBGaoOzwAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('/settings/account profile', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page);
  });

  test('changes the display name and shows it in the top bar', async ({ page }) => {
    await page.goto('/settings/account');
    const name = page.getByRole('textbox', { name: /display name/i });
    await name.fill('  Dale   Ridge ');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText('Profile saved.')).toBeVisible();
    await expect(name).toHaveValue('Dale Ridge');
    await expect(page.locator('header.topbar .standalone')).toHaveAttribute('title', 'Dale Ridge');

    await name.fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
    await expect(page.locator('header.topbar .standalone')).not.toHaveAttribute(
      'title',
      'Dale Ridge'
    );
  });

  test('saves time zone and display units', async ({ page }) => {
    await page.goto('/settings/account');
    const tz = page.getByRole('combobox', { name: /time zone/i });
    const units = page.getByRole('combobox', { name: /display units/i });
    await expect(tz).toHaveValue('America/New_York');
    await expect(units).toHaveValue('us');

    await tz.selectOption('America/Chicago');
    await units.selectOption('metric');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();

    await page.reload();
    await expect(tz).toHaveValue('America/Chicago');
    await expect(units).toHaveValue('metric');
    await expect(page.getByLabel(/last sign-in/i)).toHaveValue(/C[SD]T$/);

    await tz.selectOption('America/New_York');
    await units.selectOption('us');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
  });

  test('uploads, displays and removes a profile picture', async ({ page }) => {
    await page.goto('/settings/account');
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
    const res = await page.request.post('/api/account/avatar', {
      headers: { origin: new URL(page.url()).origin, 'content-type': 'image/svg+xml' },
      data: '<svg xmlns="http://www.w3.org/2000/svg"/>'
    });
    expect(res.status()).toBe(415);
  });
});
