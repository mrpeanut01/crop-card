import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '../e2e/lib/test';
import { provisionEmptyFarm } from '../e2e/lib/freshFarm';
import { originOf } from '../e2e/lib/newOwner';

// Device sweep (#572): a real HEIC (made with `sips -s format heic`) through
// the journal and animal photo pickers. The picker decodes on the phone and
// sends a JPEG, so what matters is whether the engine can decode HEIC.
const HEIC = readFileSync(new URL('./fixtures/leaf.heic', import.meta.url));

async function post<T>(page: Page, url: string, data: unknown, method = 'POST'): Promise<T> {
  const res = await page.request.fetch(url, {
    method,
    data: data as Record<string, unknown>,
    headers: { origin: originOf(page) }
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as T;
}

test('HEIC through the journal, animal and avatar pickers', async ({ page }, info) => {
  test.setTimeout(120_000);
  const results: Record<string, unknown> = { project: info.project.name };
  await provisionEmptyFarm(page);

  results.engineDecodesHeic = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    try {
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/heic' }));
      return `${bmp.width}x${bmp.height}`;
    } catch (e) {
      return `no (${(e as Error).name})`;
    }
  }, HEIC.toString('base64'));

  const direct = await page.request.post('/api/documents?kind=other&name=leaf.heic', {
    data: HEIC,
    headers: { origin: originOf(page) }
  });
  results.vaultDirectUpload = `${direct.status()} ${((await direct.json()) as { code?: string }).code ?? ''}`;

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

  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && /photo-help|\/api\/animals\/|avatar/.test(r.url())) {
      const body = r.postData() ?? '';
      const m = /data:(image\/[a-z]+);base64/.exec(body);
      sent.push(
        `${r.url().replace(/^https?:\/\/[^/]+/, '')} ${m?.[1] ?? r.headers()['content-type']}`
      );
    }
  });

  await page.goto(`/cards/planting/pl_${placed.planting.id}`);
  await page.waitForLoadState('networkidle');
  const help = page.getByTestId('photo-help');
  await help.getByTestId('photo-input').setInputFiles({
    name: 'IMG_0001.HEIC',
    mimeType: 'image/heic',
    buffer: HEIC
  });
  await page.waitForTimeout(1500);
  const alert = help.getByRole('alert');
  if (await alert.count()) {
    results.journal = `error: ${(await alert.first().textContent())?.trim()}`;
  } else {
    await help.getByRole('button', { name: "What's wrong with these leaves?" }).click();
    await help.getByRole('button', { name: 'Ask' }).click();
    const thumb = help.getByTestId('journal-entries').getByRole('img', { name: /^Taken / });
    await expect(thumb).toBeVisible({ timeout: 20_000 });
    const src = (await thumb.getAttribute('src'))!;
    const res = await page.request.get(src);
    results.journal = `saved, served as ${res.headers()['content-type']}`;
  }

  const created = await post<{ animal: { id: string } }>(page, '/api/animals', {
    speciesId: 'dog',
    name: 'Rex'
  });
  await page.goto(`/animals/${created.animal.id}`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Add a photo').setInputFiles({
    name: 'IMG_0002.HEIC',
    mimeType: 'image/heic',
    buffer: HEIC
  });
  const img = page.getByRole('img', { name: 'Photo of Rex' });
  const err = page.locator('.af-error');
  await expect(img.or(err).first()).toBeVisible({ timeout: 20_000 });
  if (await img.count()) {
    const res = await page.request.get(`/api/animals/${created.animal.id}/photo`);
    results.animal = `saved, served as ${res.headers()['content-type']}`;
  } else {
    results.animal = `error: ${(await err.textContent())?.trim()}`;
  }

  await page.goto('/settings/account');
  await page.waitForLoadState('networkidle');
  await page.locator('#avatar-file').setInputFiles({
    name: 'IMG_0003.HEIC',
    mimeType: 'image/heic',
    buffer: HEIC
  });
  const status = page.locator('.avatar-upload .status');
  await expect(status).not.toBeEmpty({ timeout: 20_000 });
  results.avatar = (await status.textContent())?.trim();
  await page.goto('/settings/documents');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('documents-upload-input').setInputFiles({
    name: 'IMG_0004.HEIC',
    mimeType: 'image/heic',
    buffer: HEIC
  });
  const vaultError = page.getByText(/HEIC|can't be stored/).first();
  await expect(vaultError).toBeVisible({ timeout: 20_000 });
  results.vaultUpload = (await vaultError.textContent())?.trim();
  results.requests = sent;
  console.log('RESULT ' + JSON.stringify(results));
});
