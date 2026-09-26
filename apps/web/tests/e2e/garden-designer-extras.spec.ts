import type { Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { provisionWizardTenant } from './lib/wizardTenant';

// Garden designer follow-ups: drag a crop onto a bed, Print through the
// Area Card, bed recipes saved by the server in one go, and moving a
// linked sowing to another bed. No Anthropic key in e2e.

const PHONE = { width: 375, height: 800 };
const DESKTOP = { width: 1280, height: 900 };

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: { origin: origin(page) }
  });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function gardenWithBeds(page: Page, beds: Array<{ name: string; xFt: number }>) {
  await provisionWizardTenant(page, { blocks: [], seeds: [] });
  const area = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Kitchen Garden',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  const ids: Record<string, string> = {};
  for (const b of beds) {
    const res = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: b.name,
      fieldId: area.field.id,
      kind: 'bed',
      bedStyle: 'raised',
      widthFt: 4,
      lengthFt: 8,
      xFt: b.xFt,
      yFt: 3,
      rotationDeg: 0
    });
    ids[b.name] = res.block.id;
  }
  return { areaId: area.field.id, bedIds: ids };
}

async function openDesigner(page: Page, areaId: string, query = ''): Promise<number> {
  await page.goto(`/plan/areas/${areaId}/design${query}`);
  const root = page.getByTestId('garden-designer');
  await expect(root).toHaveAttribute('data-ready', 'true');
  return Number(await root.getAttribute('data-season-year'));
}

async function scrubTo(page: Page, year: number, month: number, day: number) {
  await page.getByRole('slider').fill(String(Date.UTC(year, month - 1, day)));
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('drag a crop onto a bed', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: DESKTOP });

  test('a mouse drag from the crop panel places the crop in the bed under it', async ({ page }) => {
    const { areaId } = await gardenWithBeds(page, [
      { name: 'Bed 1', xFt: 2 },
      { name: 'Bed 2', xFt: 10 }
    ]);
    const year = await openDesigner(page, areaId, '?view=canvas');
    await scrubTo(page, year, 5, 1);
    await page.getByTestId('preset-bar').getByRole('button', { name: 'Add crop' }).click();
    const panel = page.getByTestId('crop-panel');
    await panel.getByLabel('Search crops').fill('Buttercrunch');
    const row = panel.getByTestId('crop-row').first();
    await expect(row).toBeVisible();

    const from = (await row.boundingBox())!;
    const target = page.locator('[data-testid="bed"][data-bed-name="Bed 2"]');
    await target.scrollIntoViewIfNeeded();
    const to = (await target.locator('.bed-body').boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + from.height / 2, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 3, { steps: 12 });
    await expect(page.getByTestId('drag-ghost')).toHaveAttribute('data-fits', 'true');
    await expect(page.getByTestId('drag-chip')).toContainText('Bed 2');
    await page.mouse.up();

    await expect(page.getByTestId('designer-status')).toContainText(/placed in Bed 2/);
    await expect(page.getByTestId('drag-ghost')).toHaveCount(0);
    await expect(
      target.getByTestId('footprint').or(page.getByTestId('jump-to')).first()
    ).toBeVisible();
  });
});

test.describe('Print opens the Area Card', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: PHONE });

  test('with the bed map for the scrubbed date, then prints once', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed++;
      };
    });
    const { areaId, bedIds } = await gardenWithBeds(page, [{ name: 'Bed 1', xFt: 2 }]);
    const year = await openDesigner(page, areaId, '?view=canvas');
    await post(page, '/api/garden/plantings', {
      plantings: [
        {
          blockId: bedIds['Bed 1'],
          cropPluginId: 'tomato-celebrity-f1',
          varietyDisplayName: 'Tomato Celebrity',
          plantingDateMs: Date.UTC(year, 4, 15),
          footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 },
          spacingPattern: 'square',
          source: 'manual'
        }
      ]
    });
    await page.reload();
    await expect(page.getByTestId('garden-designer')).toHaveAttribute('data-ready', 'true');
    await scrubTo(page, year, 7, 15);
    await expect(page.getByRole('slider')).toHaveAttribute('aria-valuetext', 'July 15');
    await page.getByTestId('designer-print').click();

    await expect(page).toHaveURL(new RegExp(`/cards/area/[^?]+\\?on=${year}-07-15$`));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed))
      .toBe(1);
    await page.emulateMedia({ media: 'print' });
    const map = page.locator('.card-print-sheet svg[role="img"]').first();
    await expect(map).toHaveAttribute('aria-label', /Bed 1: Tomato Celebrity/);
    await page.emulateMedia({ media: 'screen' });
    await page.reload();
    await expect(page.locator('article[data-card-kind="area"]').first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(
      0
    );
    await noHorizontalOverflow(page);
  });
});

test.describe('bed recipes and linked sowings', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const viewport of [PHONE, DESKTOP]) {
    test(`a recipe is saved in one request at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { areaId } = await gardenWithBeds(page, [{ name: 'Bed 1', xFt: 2 }]);
      await openDesigner(page, areaId, '?view=list');
      const bed1 = page.locator('[data-testid="list-bed"][data-bed-name="Bed 1"]');
      await bed1.getByRole('button', { name: /^Bed 1/ }).click();
      await bed1.getByRole('tab', { name: 'Plantings' }).click();
      await bed1.getByRole('button', { name: 'Use a bed recipe' }).click();
      const sheet = bed1.getByTestId('recipe-sheet');
      await sheet.getByRole('button', { name: /Radishes, then tomatoes/ }).click();
      const add = sheet.getByRole('button', { name: /^Add \d+ plantings?$/ });
      await expect(add).toBeEnabled();
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.url().endsWith('/recipe') && r.method() === 'POST'),
        add.click()
      ]);
      expect(req.postDataJSON()).toMatchObject({
        recipePluginId: 'radishes-then-tomatoes',
        commit: true
      });
      await expect(page.getByTestId('designer-status')).toHaveText(
        /^\d+ plantings? added from Radishes, then tomatoes\.$/
      );
      await expect(bed1.getByTestId('planting-row').first()).toBeVisible();
      await expect(bed1.locator('[data-provenance="plugin"]').first()).toBeVisible();
      if (viewport.width === PHONE.width) await noHorizontalOverflow(page);
    });
  }

  test('a linked sowing moves to another bed and stays in its series', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const { areaId, bedIds } = await gardenWithBeds(page, [
      { name: 'Bed 1', xFt: 2 },
      { name: 'Bed 2', xFt: 10 }
    ]);
    const thisSeason = await openDesigner(page, areaId, '?view=list');
    const query = `?view=list&season=${thisSeason + 1}`;
    const year = await openDesigner(page, areaId, query);
    expect(year).toBe(thisSeason + 1);
    const created = await post<{ plantings: Array<{ cropId: string }> }>(
      page,
      '/api/garden/plantings',
      {
        plantings: [
          {
            blockId: bedIds['Bed 1'],
            cropPluginId: 'lettuce-black-seeded-simpson',
            varietyDisplayName: 'Lettuce',
            plantingDateMs: Date.UTC(year, 3, 1),
            footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 24 },
            spacingPattern: 'square',
            source: 'manual'
          }
        ]
      }
    );
    const succession = await post<{ created: Array<{ cropId: string }> }>(
      page,
      `/api/garden/beds/${bedIds['Bed 1']}/succession`,
      { cropId: created.plantings[0].cropId, count: 1, commit: true }
    );
    expect(succession.created).toHaveLength(1);
    await openDesigner(page, areaId, query);

    const bed1 = page.locator('[data-testid="list-bed"][data-bed-name="Bed 1"]');
    await bed1.getByRole('button', { name: /^Bed 1/ }).click();
    await bed1.getByRole('tab', { name: 'Plantings' }).click();
    const second = bed1.getByTestId('planting-row').filter({ hasText: 'sowing 2 of 2' });
    await second.getByRole('button', { name: 'Lettuce', exact: true }).click();
    const form = second.getByTestId('move-to-bed');
    await expect(form).toContainText('It stays linked with its other sowings.');
    await form.getByRole('combobox').selectOption({ label: 'Bed 2' });
    await form.getByRole('button', { name: 'Move to bed' }).click();
    await expect(page.getByTestId('designer-status')).toHaveText(
      'Lettuce moved to Bed 2. It stays linked with its other sowings.'
    );

    await openDesigner(page, areaId, query);
    const bed2 = page.locator('[data-testid="list-bed"][data-bed-name="Bed 2"]');
    await bed2.getByRole('button', { name: /^Bed 2/ }).click();
    await bed2.getByRole('tab', { name: 'Plantings' }).click();
    await expect(bed2.getByTestId('planting-row')).toContainText('sowing 2 of 2');
    await noHorizontalOverflow(page);
  });
});
