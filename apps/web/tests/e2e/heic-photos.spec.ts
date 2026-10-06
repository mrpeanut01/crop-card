import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// #572 panel ruling H-1: Chromium cannot decode HEIC, so a HEIC picked in
// the photo pickers or the document vault says what to do instead of
// "could not be read". (Safari decodes HEIC and sends a JPEG.)
const HEIC = readFileSync(new URL('../device/fixtures/leaf.heic', import.meta.url));
const HEIC_PHOTO =
  "This browser can't open HEIC photos. Save the photo as a JPEG, take it again with the camera, or use Safari on an iPhone or Mac.";

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: { origin: originOf(page) }
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as T;
}

test('a HEIC photo gets a HEIC message in the animal picker and the vault', async ({
  page,
  browserName
}) => {
  test.skip(browserName !== 'chromium', 'Chromium never decodes HEIC; Safari does.');
  await page.setViewportSize({ width: 375, height: 800 });
  await provisionEmptyFarm(page);
  const { animal } = await post<{ animal: { id: string } }>(page, '/api/animals', {
    speciesId: 'dog',
    name: 'Rex'
  });

  await page.goto(`/animals/${animal.id}`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Add a photo').setInputFiles({
    name: 'IMG_0001.HEIC',
    mimeType: 'image/heic',
    buffer: HEIC
  });
  await expect(page.getByRole('alert')).toHaveText(HEIC_PHOTO);
  expect((await page.request.get(`/api/animals/${animal.id}/photo`)).status()).toBe(404);

  await page.goto('/settings/documents');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('documents-upload-input').setInputFiles({
    name: 'IMG_0002.HEIC',
    mimeType: 'image/heic',
    buffer: HEIC
  });
  await expect(
    page.getByText("HEIC photos can't be stored. Save it as a JPEG or PDF and upload that.")
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('document-row')).toHaveCount(0);
});
