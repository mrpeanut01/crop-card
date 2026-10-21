import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { enableFixtureClaude } from './lib/fixtureClaude';
import { reloadUnderServiceWorker } from './lib/serviceWorker';
import { FIXTURE_MARKS_DIAGNOSIS, FIXTURE_MARKS_PROBLEM } from '../../src/lib/aiFixturePhrases';

/**
 * Phase 37F: "Where do I prune?" on a photo. With no key the Care Guide
 * answers with the growth-habit drawing and the photo unmarked; with the
 * fixture Claude the answer comes back with three marks drawn over the
 * photo, a legend, and the saved journal entry redraws them.
 */

const BASIL_PINCH = 'Pinch stems as they lengthen to promote bushy, compact growth.';
/** The herb family's sourced Care Guide "Common problems" tip. */
const HERB_PROBLEM_TIP = 'Thin, spindly growth: not enough light.';
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

async function askAboutLeaves(page: Page, cropId: string, typed: string) {
  await page.goto(`/cards/planting/pl_${cropId}`);
  const help = page.getByTestId('photo-help');
  await expect(help.getByRole('heading', { name: 'Ask about a photo' })).toBeVisible();
  await help.getByTestId('photo-input').setInputFiles({
    name: 'basil.jpg',
    mimeType: 'image/jpeg',
    buffer: await plantPhoto(page)
  });
  await expect(help.getByRole('img', { name: 'What you are asking about' })).toBeVisible();
  await help.getByRole('button', { name: "What's wrong with these leaves?" }).click();
  await help.locator('textarea').first().fill(typed);
  await help.getByRole('button', { name: 'Ask' }).click();
  return help;
}

/** How many rows an IndexedDB store holds, 0 when it is not there yet. */
async function storeCount(page: Page, store: string): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('cropcard');
        req.onerror = () => resolve(0);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(name)) {
            db.close();
            resolve(0);
            return;
          }
          const count = db.transaction(name).objectStore(name).count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => {
            db.close();
            resolve(0);
          };
        };
      }),
    store
  );
}

async function stubPrint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __printed: number };
    w.__printed = 0;
    window.print = () => {
      w.__printed += 1;
    };
  });
}

async function printedCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __printed: number }).__printed);
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

  test('a problem mark is a dashed diamond with the herb Care Guide tip beside it (#869)', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    await enableFixtureClaude(page);
    const cropId = await basilInHerbGarden(page);
    const help = await askAboutLeaves(page, cropId, FIXTURE_MARKS_PROBLEM);

    const answer = help.getByTestId('photo-answer');
    await expect(answer).toHaveAttribute('data-provenance', 'ai');
    const overlay = answer.getByTestId('photo-marks');
    const marks = overlay.getByTestId('photo-mark');
    await expect(marks).toHaveCount(2);
    await expect(marks.nth(0)).toHaveAttribute('data-shape', 'circle');
    await expect(marks.nth(1)).toHaveAttribute('data-kind', 'problem');
    await expect(marks.nth(1)).toHaveAttribute('data-shape', 'diamond');
    await expect(marks.nth(1)).toHaveAccessibleName('Mark 2: Problem, Yellow lower leaves');
    const box = (await marks.nth(1).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);
    await expect(overlay.locator('svg.overlay rect.dashed')).toHaveCount(1);
    const legend = overlay.getByTestId('photo-marks-legend');
    await expect(legend.locator('li[data-kind="problem"]')).toContainText('Problem');
    await expect(legend.locator('li[data-kind="problem"]')).toContainText('Yellow lower leaves');
    await expect(overlay.getByTestId('photo-marks-key-problem')).toContainText(
      'They do not say what it is.'
    );
    const tips = overlay.getByTestId('photo-marks-problem-tips');
    await expect(tips).toContainText('Common problems');
    await expect(tips).toContainText(HERB_PROBLEM_TIP);
    await expect(overlay.getByTestId('photo-marks-extension')).toHaveCount(0);

    await page.reload();
    const again = page.getByTestId('journal-entries').getByTestId('photo-marks');
    await expect(again.locator('[data-testid="photo-mark"][data-kind="problem"]')).toHaveCount(1);
    await expect(again.getByTestId('photo-marks-problem-tips')).toContainText(HERB_PROBLEM_TIP);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a problem label that names a disease drops every mark and keeps the steps (#869)', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    await enableFixtureClaude(page);
    const cropId = await basilInHerbGarden(page);
    const help = await askAboutLeaves(page, cropId, FIXTURE_MARKS_DIAGNOSIS);

    const answer = help.getByTestId('photo-answer');
    await expect(answer).toHaveAttribute('data-provenance', 'ai');
    await expect(answer.getByTestId('photo-marks')).toHaveCount(0);
    await expect(answer.getByTestId('marks-refused')).toContainText(
      'Claude could not place marks on this photo.'
    );
    await expect(answer).toContainText('Placeholder problem step.');
    await expect(answer).not.toContainText('Powdery mildew');
    await expect(help.getByTestId('journal-entries').getByTestId('photo-marks')).toHaveCount(0);
  });

  test('a marked entry prints as a numbered sheet on Letter or a 4x6 card (#869)', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    await enableFixtureClaude(page);
    const cropId = await basilInHerbGarden(page);
    const help = await askAboutLeaves(page, cropId, FIXTURE_MARKS_PROBLEM);
    await expect(help.getByTestId('photo-answer').getByTestId('photo-mark')).toHaveCount(2);
    await page.reload();

    const entry = page.getByTestId('journal-entries').locator(':scope > li').first();
    const open = entry.getByTestId('photo-print-open');
    await expect(open).toHaveText('Print');
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Print the marked photo' });
    await expect(dialog).toBeVisible();
    const preview = dialog.getByTestId('photo-print-preview');
    await expect(preview.getByTestId('photo-print-number')).toHaveCount(2);
    await expect(dialog.getByRole('radio', { name: /Letter, portrait/ })).toBeChecked();
    for (const opt of await dialog.locator('label.opt').all()) {
      expect((await opt.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
    await expect(preview.getByTestId('photo-print-steps').locator('li')).toHaveCount(2);
    await dialog.getByRole('radio', { name: /4×6 index card/ }).check();
    await expect(preview).toHaveAttribute('data-layout', 'index-4x6');
    await expect(preview.getByTestId('photo-print-steps')).toHaveCount(0);

    await stubPrint(page);
    const go = dialog.getByTestId('photo-print-go');
    expect((await go.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await go.click();
    await expect.poll(() => printedCount(page)).toBe(1);
    await expect(dialog).toBeHidden();

    await page.emulateMedia({ media: 'print' });
    const sheet = page.getByTestId('photo-print-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-layout', 'index-4x6');
    await expect(page.locator('.card-print-sheet')).toHaveCount(0);
    await expect(page.getByTestId('photo-help')).toBeHidden();
    await expect(sheet.getByTestId('photo-print-number')).toHaveText(['1', '2']);
    await expect(sheet.getByTestId('photo-print-lines').locator('li')).toHaveText([
      /1\s*Cut: Mark one/,
      /2\s*Problem: Yellow lower leaves/
    ]);
    await expect(sheet).toContainText('Basil');
    await expect(sheet).toContainText('Photo from');
    await expect(sheet.locator('[data-provenance="ai"]')).toHaveCount(1);
    await expect(sheet.getByTestId('photo-print-asof')).toContainText('As of');
    await page.emulateMedia({ media: 'screen' });
    await expect(sheet).toBeHidden();
  });
});

test.describe('photo marks offline (#869, FU869-3)', () => {
  test.use({ serviceWorkers: 'allow', viewport: { width: 375, height: 800 } });

  const PHOTO_URL = /\/api\/plantings\/.+\/photo$/;

  test('a marked entry opened online redraws from the saved copy with no signal and prints', async ({
    page,
    context
  }) => {
    test.setTimeout(150_000);
    await provisionEmptyFarm(page);
    await enableFixtureClaude(page);
    const cropId = await basilInHerbGarden(page);
    const help = await askWherePrune(page, cropId);
    await expect(help.getByTestId('photo-answer').getByTestId('photo-mark')).toHaveCount(3);
    await expect.poll(() => storeCount(page, 'journalCopies'), { timeout: 20_000 }).toBe(1);

    await reloadUnderServiceWorker(page);
    await expect.poll(() => storeCount(page, 'farmSnapshots'), { timeout: 20_000 }).toBe(1);
    await expect(page.getByTestId('journal-entries').getByTestId('photo-mark')).toHaveCount(3);

    await context.setOffline(true);
    await context.route(PHOTO_URL, (route) => route.abort('internetdisconnected'));
    await page.goto(`/cards/planting/pl_${cropId}`);
    await page.waitForLoadState('networkidle');

    const copies = page.getByTestId('journal-saved-copies');
    await expect(copies.getByTestId('journal-saved-copy')).toHaveCount(1);
    await expect(copies.getByTestId('journal-saved-note')).toHaveText(/^Saved copy from .+\.$/);
    const overlay = copies.getByTestId('photo-marks');
    await expect(overlay.getByTestId('photo-marks-image')).toHaveAttribute(
      'src',
      /^data:image\/jpeg;base64,/
    );
    const marks = overlay.getByTestId('photo-mark');
    await expect(marks).toHaveCount(3);
    const imgBox = (await overlay.getByTestId('photo-marks-image').boundingBox())!;
    const first = (await marks.first().boundingBox())!;
    expect(Math.abs(first.x + first.width / 2 - (imgBox.x + imgBox.width * 0.3))).toBeLessThan(1);
    await expect(copies.getByRole('button', { name: /^Delete/ })).toHaveCount(0);

    await stubPrint(page);
    await copies.getByTestId('photo-print-open').click();
    const dialog = page.getByRole('dialog', { name: 'Print the marked photo' });
    await dialog.getByTestId('photo-print-go').click();
    await expect.poll(() => printedCount(page)).toBe(1);
    await page.emulateMedia({ media: 'print' });
    const sheet = page.getByTestId('photo-print-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('photo-print-number')).toHaveCount(3);
    await expect(sheet.getByTestId('photo-print-saved')).toHaveText(/^Saved copy from .+\.$/);
    await page.emulateMedia({ media: 'screen' });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.unroute(PHOTO_URL);
    await context.setOffline(false);
  });
});
