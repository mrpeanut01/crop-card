import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

/**
 * Phase 33A A4: journal and animal photos keep working end to end whether
 * they land in the document vault or, with the vault off, inline. Clients
 * still send JPEG data URLs and read photos from the same URLs (A-43).
 */

const SECRET = 'GPS 38.9000N 77.6000W';

async function post<T>(page: Page, url: string, data: unknown, method = 'POST'): Promise<T> {
  const res = await page.request.fetch(url, {
    method,
    data: data as Record<string, unknown>,
    headers: { origin: originOf(page) }
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as T;
}

async function tomato(page: Page): Promise<string> {
  const area = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Kitchen Garden',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  const bed = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Bed 1',
    fieldId: area.field.id,
    kind: 'bed',
    bedStyle: 'raised',
    widthFt: 4,
    lengthFt: 8,
    xFt: 2,
    yFt: 3,
    rotationDeg: 0
  });
  const placed = await post<{ planting: { id: string } }>(
    page,
    `/api/blocks/${bed.block.id}/plantings`,
    {
      cropPluginId: 'tomato-amish-paste',
      footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 48 },
      spacingPattern: 'square'
    }
  );
  return placed.planting.id;
}

/** A browser-made JPEG with an EXIF segment holding `SECRET`. */
async function photo(page: Page, color: string): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ([fill, secret]) => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, 640, 480);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9));
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      const payload = [...'Exif\0\0', ...secret].map((c) => c.charCodeAt(0));
      const len = payload.length + 2;
      const app1 = [0xff, 0xe1, len >> 8, len & 0xff, ...payload];
      const out = new Uint8Array(jpeg.length + app1.length);
      out.set(jpeg.subarray(0, 2), 0);
      out.set(app1, 2);
      out.set(jpeg.subarray(2), 2 + app1.length);
      let bin = '';
      for (const b of out) bin += String.fromCharCode(b);
      return btoa(bin);
    },
    [color, SECRET] as const
  );
  return Buffer.from(b64, 'base64');
}

async function expectLoadedJpeg(page: Page, src: string): Promise<Buffer> {
  const res = await page.request.get(src);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/jpeg');
  const bytes = await res.body();
  expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(bytes.toString('latin1')).not.toContain(SECRET);
  return bytes;
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('photos after the vault move', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('a journal photo saves, shows, survives a reload and goes with its entry', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    const cropId = await tomato(page);

    await page.goto(`/cards/planting/pl_${cropId}`);
    await page.waitForLoadState('networkidle');
    const help = page.getByTestId('photo-help');
    await help.getByTestId('photo-input').setInputFiles({
      name: 'leaf.jpg',
      mimeType: 'image/jpeg',
      buffer: await photo(page, '#3a7')
    });
    await help.getByRole('button', { name: "What's wrong with these leaves?" }).click();
    await help.getByRole('button', { name: 'Ask' }).click();
    await expect(help.getByTestId('photo-answer')).toBeVisible();

    const entries = help.getByTestId('journal-entries');
    const thumb = entries.getByRole('img', { name: /^Taken / });
    await expect(thumb).toBeVisible();
    await expect
      .poll(() => thumb.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const src = (await thumb.getAttribute('src'))!;
    const first = await expectLoadedJpeg(page, src);

    await page.reload();
    await page.waitForLoadState('networkidle');
    const again = page.getByTestId('journal-entries').getByRole('img', { name: /^Taken / });
    await expect(again).toBeAttached();
    await again.scrollIntoViewIfNeeded();
    await expect(again).toBeVisible();
    await expect
      .poll(() => again.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    expect((await expectLoadedJpeg(page, src)).equals(first)).toBe(true);
    await noHorizontalOverflow(page);

    const entry = page.getByTestId('journal-entries').locator('li').first();
    await entry.getByRole('button', { name: 'Delete…' }).click();
    await entry.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByTestId('journal-entries').locator('li')).toHaveCount(0);
    expect((await page.request.get(src)).status()).toBe(404);
  });

  test('an animal photo can be added, changed and removed', async ({ page }) => {
    await provisionEmptyFarm(page);
    const created = await post<{ animal: { id: string } }>(page, '/api/animals', {
      speciesId: 'dog',
      name: 'Rex'
    });
    const id = created.animal.id;

    await page.goto(`/animals/${id}`);
    await page.waitForLoadState('networkidle');
    const pick = page.getByText('Add a photo', { exact: true });
    await expect(pick).toBeVisible();
    expect((await pick.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await page.getByLabel('Add a photo').setInputFiles({
      name: 'rex.jpg',
      mimeType: 'image/jpeg',
      buffer: await photo(page, '#a63')
    });
    const img = page.getByRole('img', { name: 'Photo of Rex' });
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const firstBytes = await expectLoadedJpeg(page, `/api/animals/${id}/photo`);

    await page.getByLabel('Change photo').setInputFiles({
      name: 'rex2.jpg',
      mimeType: 'image/jpeg',
      buffer: await photo(page, '#36a')
    });
    await expect(page.getByText('Change photo', { exact: true })).toBeVisible();
    await expect
      .poll(async () =>
        (await expectLoadedJpeg(page, `/api/animals/${id}/photo`)).equals(firstBytes)
      )
      .toBe(false);
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await noHorizontalOverflow(page);

    await post(page, `/api/animals/${id}`, { photo: null }, 'PATCH');
    expect((await page.request.get(`/api/animals/${id}/photo`)).status()).toBe(404);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Add a photo', { exact: true })).toBeVisible();
  });

  test('a photo question asked with no signal saves its photo when it replays', async ({
    page,
    context
  }) => {
    await provisionEmptyFarm(page);
    const cropId = await tomato(page);
    await page.goto(`/cards/planting/pl_${cropId}`);
    await page.waitForLoadState('networkidle');
    const help = page.getByTestId('photo-help');
    await help.getByTestId('photo-input').setInputFiles({
      name: 'fruit.jpg',
      mimeType: 'image/jpeg',
      buffer: await photo(page, '#c33')
    });
    await expect(help.getByRole('img', { name: 'What you are asking about' })).toBeVisible();

    await context.setOffline(true);
    await help.getByRole('button', { name: 'Is it ready to pick?' }).click();
    await help.getByRole('button', { name: 'Ask' }).click();
    await expect(help.getByTestId('journal-queued')).toContainText('Is it ready to pick?');

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(help.getByTestId('journal-queued')).toHaveCount(0, { timeout: 20_000 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    const thumb = page.getByTestId('journal-entries').getByRole('img', { name: /^Taken / });
    await expect(thumb).toBeAttached({ timeout: 20_000 });
    await thumb.scrollIntoViewIfNeeded();
    await expect(thumb).toBeVisible();
    await expectLoadedJpeg(page, (await thumb.getAttribute('src'))!);
  });
});
