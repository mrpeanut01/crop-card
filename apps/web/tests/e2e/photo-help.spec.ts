import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';

/**
 * Phase 30G: Care Guide cards and "Ask about a photo" on Planting and
 * garden Area Cards, with no Anthropic key (the Care Guide answers), the
 * planting journal, EXIF stripping, and a question asked with no signal.
 */

const EXIF_SECRET = 'GPS 39.1157N 77.5636W';

function originOf(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: { origin: originOf(page) }
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as T;
}

async function gardenWithTomato(page: Page): Promise<{ areaId: string; cropId: string }> {
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
  return { areaId: area.field.id, cropId: placed.planting.id };
}

/** A 1600x1200 JPEG from the browser's own encoder with an EXIF segment
 *  spliced in after the start-of-image marker. */
async function photoWithExif(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async (secret) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#b33';
    ctx.fillRect(0, 0, 1600, 1200);
    ctx.fillStyle = '#3a3';
    ctx.fillRect(400, 300, 800, 600);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const payload = [...'Exif\0\0'].map((c) => c.charCodeAt(0));
    payload.push(...[...secret].map((c) => c.charCodeAt(0)));
    const len = payload.length + 2;
    const app1 = [0xff, 0xe1, len >> 8, len & 0xff, ...payload];
    const out = new Uint8Array(jpeg.length + app1.length);
    out.set(jpeg.subarray(0, 2), 0);
    out.set(app1, 2);
    out.set(jpeg.subarray(2), 2 + app1.length);
    let bin = '';
    for (const b of out) bin += String.fromCharCode(b);
    return btoa(bin);
  }, EXIF_SECRET);
  const buf = Buffer.from(b64, 'base64');
  expect(buf.toString('latin1')).toContain(EXIF_SECRET);
  return buf;
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('Care Guide and photo help', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('a Planting Card shows how to care for it and answers a photo question with no key', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    const { cropId } = await gardenWithTomato(page);

    await page.goto(`/cards/planting/pl_${cropId}`);
    const planting = page.locator('article[data-card-kind="planting"][data-variant="screen"]');
    await expect(planting).toBeVisible();
    await expect(planting.getByRole('link', { name: 'How to care for it' })).toHaveAttribute(
      'href',
      '/cards/careGuide/cg_tomato-amish-paste'
    );

    const care = page.getByTestId('care-guides');
    await expect(care.getByRole('heading', { name: 'How to care for it' })).toBeVisible();
    await expect(care.locator('[data-card-kind="careGuide"]')).toContainText('Stake and prune');
    await expect(care).toContainText('Deep red, dry-feeling flesh');

    const help = page.getByTestId('photo-help');
    await expect(help.getByRole('heading', { name: 'Ask about a photo' })).toBeVisible();
    await help.getByTestId('photo-input').setInputFiles({
      name: 'tomato.jpg',
      mimeType: 'image/jpeg',
      buffer: await photoWithExif(page)
    });
    await expect(help.getByRole('img', { name: 'What you are asking about' })).toBeVisible();
    const ready = help.getByRole('button', { name: 'Is it ready to pick?' });
    await ready.click();
    await expect(ready).toHaveAttribute('aria-pressed', 'true');
    const ask = help.getByRole('button', { name: 'Ask' });
    expect((await ask.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await ask.click();

    const answer = help.getByTestId('photo-answer');
    await expect(answer).toHaveAttribute('data-provenance', 'fallback');
    await expect(answer).toContainText('Claude is off, so here is what the Care Guide says.');
    await expect(answer).toContainText('Harvest cues');
    await expect(answer).toContainText('Deep red, dry-feeling flesh');

    const entries = help.getByTestId('journal-entries');
    await expect(entries.locator('li')).toHaveCount(1);
    await expect(entries).toContainText('Is it ready to pick?');
    const thumb = entries.getByRole('img', { name: /^Taken / });
    await expect(thumb).toBeVisible();
    const width = await thumb.evaluate((img) => (img as HTMLImageElement).naturalWidth);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(1024);
    const src = (await thumb.getAttribute('src'))!;
    const bytes = await (await page.request.get(src)).body();
    expect(bytes.length).toBeLessThanOrEqual(300 * 1024);
    expect(bytes.toString('latin1')).not.toContain(EXIF_SECRET);

    await help.getByLabel('Add a note').fill('Staked and tied today');
    await help.getByRole('button', { name: 'Save note' }).click();
    await expect(entries.locator('li')).toHaveCount(2);
    const newest = entries.locator('li').first();
    await newest.getByRole('button', { name: 'Delete…' }).click();
    await newest.getByRole('button', { name: 'Cancel' }).click();
    await expect(entries.locator('li')).toHaveCount(2);
    await newest.getByRole('button', { name: 'Delete…' }).click();
    await newest.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(entries.locator('li')).toHaveCount(1);

    await noHorizontalOverflow(page);
  });

  test('a garden Area Card lists care guides and asks which planting, offline too', async ({
    page,
    context
  }) => {
    await provisionEmptyFarm(page);
    const { areaId } = await gardenWithTomato(page);

    await page.goto(`/cards/area/ar_${areaId}`);
    const area = page.locator('article[data-card-kind="area"][data-variant="screen"]');
    await expect(area).toBeVisible();
    await expect(
      area.getByRole('link', { name: /^How to care for Tomato Amish Paste/ })
    ).toBeVisible();
    await expect(page.getByTestId('care-guides')).toContainText('Common problems');
    const help = page.getByTestId('photo-help');
    await expect(help).toContainText('About Tomato Amish Paste');
    await expect(help.getByText('Nothing here yet.')).toBeVisible();

    await context.setOffline(true);
    await help.getByRole('button', { name: 'Where do I prune?' }).click();
    await help.getByRole('button', { name: 'Ask' }).click();
    const answer = help.getByTestId('photo-answer');
    await expect(answer).toContainText('No signal right now');
    await expect(answer).toContainText('Stake and prune');
    await expect(answer.getByText('Will save when online')).toBeVisible();
    await expect(help.getByTestId('journal-queued')).toContainText('Where do I prune?');
    await expect(help.getByRole('button', { name: 'Where do I prune?' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(help.getByRole('button', { name: 'Ask' })).toBeDisabled();
    await noHorizontalOverflow(page);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(help.getByTestId('journal-queued')).toHaveCount(0, { timeout: 20_000 });
    await expect(help.getByTestId('journal-entries').locator('li')).toHaveCount(1, {
      timeout: 20_000
    });
    await page.reload();
    await expect(page.getByTestId('photo-help').getByTestId('journal-entries')).toContainText(
      'Where do I prune?',
      { timeout: 20_000 }
    );
  });

  test('a helper can ask and add notes but cannot delete', async ({ page, browser }) => {
    await provisionEmptyFarm(page);
    const { cropId } = await gardenWithTomato(page);
    const helper = await provisionHelper(page, browser);
    await helper.setViewportSize({ width: 375, height: 800 });

    await helper.goto(`/cards/planting/pl_${cropId}`);
    const help = helper.getByTestId('photo-help');
    await help.getByLabel('Or ask in your own words').fill('What should I spray on the aphids?');
    await help.getByRole('button', { name: 'Ask' }).click();
    const answer = help.getByTestId('photo-answer');
    await expect(answer).toContainText('For anything you would spray, use the Spray flow');
    await expect(answer.getByRole('link', { name: 'Open the Spray flow' })).toBeVisible();
    await expect(help.getByTestId('journal-entries').locator('li')).toHaveCount(1);
    await expect(help.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
    await helper.context().close();
  });
});
