import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { enableFixtureClaude } from './lib/fixtureClaude';

/**
 * Phase 37F: "Where do I prune?" on a photo. With no key the Care Guide
 * answers with the growth-habit drawing and the photo unmarked; with the
 * fixture Claude the answer comes back with three marks drawn over the
 * photo, a legend, and the saved journal entry redraws them.
 */

const BASIL_PINCH = 'Pinch stems as they lengthen to promote bushy, compact growth.';
const BASIL_BUDS = 'Basil flower buds should be removed by pinching as soon as you see them form.';

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

async function basilInHerbGarden(page: Page): Promise<string> {
  const area = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Herb garden',
    kind: 'garden',
    widthFt: 10,
    lengthFt: 10
  });
  const bed = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Bed 1',
    fieldId: area.field.id,
    kind: 'bed',
    bedStyle: 'raised',
    widthFt: 4,
    lengthFt: 4,
    xFt: 1,
    yFt: 1,
    rotationDeg: 0
  });
  const placed = await post<{ planting: { id: string } }>(
    page,
    `/api/blocks/${bed.block.id}/plantings`,
    {
      cropPluginId: 'basil-genovese',
      footprint: { x_in: 0, y_in: 0, w_in: 24, l_in: 24 },
      spacingPattern: 'square'
    }
  );
  return placed.planting.id;
}

async function plantPhoto(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 900;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e8efe2';
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = '#3a7a3a';
    ctx.fillRect(500, 200, 200, 600);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.85));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  });
  return Buffer.from(b64, 'base64');
}

async function askWherePrune(page: Page, cropId: string) {
  await page.goto(`/cards/planting/pl_${cropId}`);
  const help = page.getByTestId('photo-help');
  await expect(help.getByRole('heading', { name: 'Ask about a photo' })).toBeVisible();
  await help.getByTestId('photo-input').setInputFiles({
    name: 'basil.jpg',
    mimeType: 'image/jpeg',
    buffer: await plantPhoto(page)
  });
  await expect(help.getByRole('img', { name: 'What you are asking about' })).toBeVisible();
  await help.getByRole('button', { name: 'Where do I prune?' }).click();
  await help.getByRole('button', { name: 'Ask' }).click();
  return help;
}

test.describe('photo marks', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('with no key the Care Guide answers with the drawing and no marks', async ({ page }) => {
    await provisionEmptyFarm(page);
    const cropId = await basilInHerbGarden(page);
    const help = await askWherePrune(page, cropId);

    const answer = help.getByTestId('photo-answer');
    await expect(answer).toHaveAttribute('data-provenance', 'fallback');
    await expect(answer).toContainText('Claude is off, so here is what the Care Guide says.');
    const drawing = answer.getByTestId('prune-drawing');
    await expect(drawing).toHaveAttribute('data-drawing', 'cut-and-come-again-leafy');
    await expect(drawing.getByRole('img', { name: /Line drawing of a leafy/ })).toBeVisible();
    await expect(drawing.getByRole('img', { name: 'Your photo' })).toBeVisible();
    await expect(drawing.getByTestId('prune-drawing-caption')).toContainText(BASIL_PINCH);
    await expect(drawing.getByTestId('prune-drawing-caption')).toContainText(BASIL_BUDS);
    await expect(answer.getByTestId('photo-marks')).toHaveCount(0);

    const svg = await page.request.get('/prune/cut-and-come-again-leafy.svg');
    expect(svg.status()).toBe(200);
    expect(await svg.text()).not.toContain('<text');
  });

  test('the fixture Claude draws three marks, a legend, and the saved entry redraws them', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    await enableFixtureClaude(page);
    const cropId = await basilInHerbGarden(page);
    const help = await askWherePrune(page, cropId);

    const answer = help.getByTestId('photo-answer');
    await expect(answer).toHaveAttribute('data-provenance', 'ai');
    const overlay = answer.getByTestId('photo-marks');
    const marks = overlay.getByTestId('photo-mark');
    await expect(marks).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const box = (await marks.nth(i).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(48);
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
    await expect(marks.first()).toHaveAccessibleName('Mark 1: Cut, Mark one');
    const legend = overlay.getByTestId('photo-marks-legend');
    await expect(legend.locator('li')).toHaveCount(3);
    await expect(legend).toContainText('Pinch');
    await expect(legend).toContainText('Harvest');
    await expect(overlay.getByTestId('photo-marks-steps').locator('li')).toHaveCount(3);

    const img = overlay.getByTestId('photo-marks-image');
    const imgBox = (await img.boundingBox())!;
    const first = (await marks.first().boundingBox())!;
    expect(Math.abs(first.x + first.width / 2 - (imgBox.x + imgBox.width * 0.3))).toBeLessThan(1);
    expect(Math.abs(first.y + first.height / 2 - (imgBox.y + imgBox.height * 0.25))).toBeLessThan(
      1
    );
    await marks.first().click();
    await expect(marks.first()).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    const saved = page.getByTestId('journal-entries');
    await expect(saved.locator(':scope > li')).toHaveCount(1);
    const again = saved.getByTestId('photo-marks');
    await expect(again.getByTestId('photo-mark')).toHaveCount(3);
    await expect(again.getByTestId('photo-marks-legend').locator('li')).toHaveCount(3);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
