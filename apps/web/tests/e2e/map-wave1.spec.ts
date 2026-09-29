import type { Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { provisionWizardTenant } from './lib/wizardTenant';

// Farm map and garden follow-ups: a Delete control with Select mode and
// right-click on every map object (#476), a small coop or pen that saves
// and suggests a sourced capacity (#477), a hydrant or waterer that serves
// several Areas (#478), and scheduled plantings drawn on the bed diagram and
// the printed Area Card (#481). Tiles are stubbed; there is no Anthropic key.

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

async function openMap(page: Page) {
  await page.goto('/settings/farm/map');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: '+ Add' })).toBeEnabled();
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const LAT = 39.1;
const LON = -77.55;
const FT_LAT = 1 / 364_000;
const FT_LON = 1 / (364_000 * Math.cos((LAT * Math.PI) / 180));

/** A square `size` ft on a side, its south-west corner `dx`, `dy` ft from the point. */
function square(dx: number, dy: number, size = 60) {
  const x0 = LON + dx * FT_LON;
  const y0 = LAT + dy * FT_LAT;
  const x1 = x0 + size * FT_LON;
  const y1 = y0 + size * FT_LAT;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0]
      ]
    ]
  };
}

async function fields(page: Page) {
  const res = await page.request.get('/api/fields');
  return (
    (await res.json()) as {
      fields: Array<{
        id: string;
        name: string;
        kind: string;
        geometryGeojson?: string | null;
        details?: Record<string, unknown> | null;
      }>;
    }
  ).fields;
}

async function features(page: Page) {
  const res = await page.request.get('/api/map-features');
  return (
    (await res.json()) as {
      mapFeatures: Array<{ id: string; kind: string; name: string; areaIds?: string[] }>;
    }
  ).mapFeatures;
}

test.describe('farm map: delete shapes (#476)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('Select picks several shapes and one Delete removes them after a confirm', async ({
    page
  }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await page.setViewportSize({ width: 1280, height: 1100 });
    const west = await post<{ field: { id: string } }>(page, '/api/fields', {
      name: 'West paddock',
      kind: 'pasture',
      geometryGeojson: square(-200, -30)
    });
    await post(page, '/api/fields', {
      name: 'East garden',
      kind: 'garden',
      geometryGeojson: square(140, -30)
    });
    const fence = await post<{ mapFeature: { id: string } }>(page, '/api/map-features', {
      kind: 'fence',
      name: 'Lane fence',
      geometry: {
        type: 'LineString',
        coordinates: [
          [LON - 60 * FT_LON, LAT + 60 * FT_LAT],
          [LON + 60 * FT_LON, LAT + 120 * FT_LAT]
        ]
      }
    });
    await openMap(page);

    await expect(page.getByTestId('map-delete-hint')).toHaveText(
      /Right-click a shape to delete it\. To delete several, tap Select\./
    );
    const select = page.getByRole('button', { name: 'Select', exact: true });
    await expect(select).toHaveAttribute('aria-pressed', 'false');
    expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await select.click();
    await expect(page.getByTestId('map-delete-hint')).toHaveText(/Tap the shapes you want/);
    await expect(page.getByTestId('map-delete-selected')).toBeDisabled();

    await page.locator(`path[data-area-id="${west.field.id}"]`).click();
    const line = (await page.locator('path.feature-fence').boundingBox())!;
    await page.mouse.click(line.x + line.width / 2, line.y + line.height / 2);
    await expect(page.getByTestId('map-delete-selected')).toHaveText('Delete 2 shapes');
    await expect(page.getByTestId('area-card-sheet')).toHaveCount(0);

    await page.getByTestId('map-delete-selected').click();
    const confirm = page.getByTestId('map-delete-confirm');
    await expect(confirm).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Delete 2 shapes?' })).toBeVisible();
    await expect(confirm).toContainText(
      'The outline of West paddock (pasture) comes off the map. The Area and its records stay.'
    );
    await expect(confirm).toContainText('Lane fence (fence) is deleted.');
    const del = confirm.getByRole('button', { name: 'Delete 2' });
    expect((await del.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await del.click();
    await expect(confirm).toHaveCount(0);

    await expect
      .poll(async () => (await fields(page)).find((f) => f.id === west.field.id)?.geometryGeojson)
      .toBeFalsy();
    expect((await fields(page)).map((f) => f.name).sort()).toEqual(['East garden', 'West paddock']);
    expect((await features(page)).map((f) => f.id)).not.toContain(fence.mapFeature.id);
  });

  test('right-click opens the same confirm, and Cancel keeps the shape', async ({ page }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await page.setViewportSize({ width: 1280, height: 1000 });
    const garden = await post<{ field: { id: string } }>(page, '/api/fields', {
      name: 'Kitchen garden',
      kind: 'garden',
      geometryGeojson: square(-30, -30)
    });
    await openMap(page);
    await page.locator(`path[data-area-id="${garden.field.id}"]`).click({ button: 'right' });
    const confirm = page.getByTestId('map-delete-confirm');
    await expect(page.getByRole('heading', { name: 'Delete Kitchen garden?' })).toBeVisible();
    await expect(confirm).toContainText(/checks that use the map/);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    expect((await fields(page))[0].geometryGeojson).toBeTruthy();
  });

  test('a phone says long-press and the controls fit the screen', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 800 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await provisionWizardTenant(page, { blocks: [] });
    await openMap(page);
    await expect(page.getByTestId('map-delete-hint')).toContainText(
      'Long-press a shape to delete it.'
    );
    await noHorizontalOverflow(page);
    await context.close();
  });
});

test.describe('coop or pen (#477)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('a small drawn coop saves, suggests a sourced number and keeps a typed one', async ({
    page
  }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await page.setViewportSize({ width: 1280, height: 1100 });
    await openMap(page);

    const zoomIn = page.locator('.leaflet-control-zoom-in');
    for (let i = 0; i < 12; i++) {
      if ((await zoomIn.getAttribute('aria-disabled')) === 'true') break;
      const clicked = await zoomIn
        .click({ timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (!clicked) break;
      await page.waitForTimeout(250);
    }
    await page.getByRole('button', { name: '+ Add' }).click();
    await page
      .getByRole('dialog', { name: 'Add to map' })
      .getByRole('button', { name: /^Coop or pen/ })
      .click();

    const map = page.locator('.leaflet-container');
    await map.scrollIntoViewIfNeeded();
    const box = (await map.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const corners: Array<[number, number]> = [
      [cx - 50, cy - 40],
      [cx + 50, cy - 40],
      [cx + 50, cy + 40],
      [cx - 50, cy + 40]
    ];
    for (const [x, y] of corners) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(150);
    }
    await page.mouse.click(corners[0][0], corners[0][1]);

    const modal = page.getByRole('dialog', { name: /New coop or pen/ });
    await expect(modal).toBeVisible();
    await modal.getByLabel('Name').fill('Hen house');
    await modal.getByLabel('Animal type').selectOption('chicken');
    await modal.getByLabel('Is it indoors, a run, or both?').selectOption('indoor');
    const suggestion = modal.getByTestId('coop-suggestion');
    await expect(suggestion).toContainText(/Suggested: up to \d+ chickens/);
    await expect(suggestion).toContainText('Source: eXtension Small and Backyard Poultry.');
    const capacity = modal.getByLabel('Holds up to');
    await expect(capacity).toHaveValue(/^\d+$/);
    await capacity.fill('6');
    await expect(modal.getByRole('button', { name: /^Use \d+ instead$/ })).toBeVisible();
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toHaveCount(0);

    await expect
      .poll(async () => (await fields(page)).find((f) => f.name === 'Hen house')?.details)
      .toMatchObject({
        speciesId: 'chicken',
        space: 'indoor',
        capacity: 6,
        capacityProvenance: 'manual'
      });

    await page.locator('path[data-area-kind="coop_pen"]').click();
    const sheet = page.getByTestId('area-card-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Chicken', { exact: true })).toBeVisible();
    await expect(sheet.getByText('6 chickens')).toBeVisible();
  });

  test('on a phone, Save on a drawn coop is above the Continue bar on /plan/farm', async ({
    page
  }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/plan/farm');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: '+ Add' })).toBeEnabled();
    const zoomIn = page.locator('.leaflet-control-zoom-in');
    for (let i = 0; i < 12; i++) {
      if ((await zoomIn.getAttribute('aria-disabled')) === 'true') break;
      const clicked = await zoomIn
        .click({ timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (!clicked) break;
      await page.waitForTimeout(250);
    }
    await page.getByRole('button', { name: '+ Add' }).click();
    await page
      .getByRole('dialog', { name: 'Add to map' })
      .getByRole('button', { name: /^Coop or pen/ })
      .click();
    const map = page.locator('.leaflet-container');
    await map.scrollIntoViewIfNeeded();
    const box = (await map.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + Math.min(box.height / 2, 160);
    const corners: Array<[number, number]> = [
      [cx - 40, cy - 30],
      [cx + 40, cy - 30],
      [cx + 40, cy + 30],
      [cx - 40, cy + 30]
    ];
    for (const [x, y] of corners) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(150);
    }
    await page.mouse.click(corners[0][0], corners[0][1]);

    const modal = page.getByRole('dialog', { name: /New coop or pen/ });
    await expect(modal).toBeVisible();
    await modal.getByLabel('Name').fill('Phone coop');
    await modal.getByLabel('Animal type').selectOption('chicken');
    await modal.getByLabel('Is it indoors, a run, or both?').selectOption('indoor');
    const save = modal.getByRole('button', { name: 'Save' });
    await save.scrollIntoViewIfNeeded();
    const hit = await save.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === el || el.contains(top);
    });
    expect(hit).toBe(true);
    await save.click();
    await expect(modal).toHaveCount(0);
    await expect
      .poll(async () => (await fields(page)).find((f) => f.name === 'Phone coop')?.kind)
      .toBe('coop_pen');
  });

  test('both a shelter and a run use the smaller count, sketched by size', async ({ page }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/settings/farm/map');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Dimensions/ }).click();
    await page.getByRole('button', { name: '+ Add' }).click();
    await page
      .getByRole('dialog', { name: 'Add to map' })
      .getByRole('button', { name: /^Coop or pen/ })
      .click();
    const form = page.getByTestId('sketch-add-field');
    await form.getByLabel('Name').fill('Layer coop');
    await form.getByLabel('Width (ft)').fill('8');
    await form.getByLabel('Length (ft)').fill('10');
    await form.getByLabel('Animal type').selectOption('chicken');
    await form.getByLabel('Is it indoors, a run, or both?').selectOption('both');
    await form.getByLabel('Shelter floor').fill('35');
    await form.getByLabel('Run', { exact: true }).fill('60');
    await expect(form.getByLabel('Holds up to')).toHaveValue('6');
    await noHorizontalOverflow(page);
    await form.getByRole('button', { name: /Add coop or pen/ }).click();
    await expect
      .poll(async () => (await fields(page)).find((f) => f.name === 'Layer coop')?.details)
      .toMatchObject({ capacity: 6, capacityProvenance: 'data', shelterSqFt: 35, runSqFt: 60 });
  });
});

test.describe('coop or pen added without drawing', () => {
  test('a typed size suggests a capacity on the phone form', async ({ page }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await page.setViewportSize({ width: 375, height: 800 });
    await openMap(page);
    await page.getByText('Add without drawing').click();
    const panel = page.locator('details.advanced');
    await panel.getByLabel('Kind').selectOption('coop_pen');
    await panel.getByLabel('Name').fill('Hen house');
    await panel.getByLabel('Animal type').selectOption('chicken');
    await panel.getByLabel('Is it indoors, a run, or both?').selectOption('indoor');
    await expect(panel.getByText('Give it a size, or draw it on the map')).toBeVisible();
    await panel.getByLabel('Size (optional)').fill('0.005');
    const holds = panel.getByLabel('Holds up to');
    await expect(holds).not.toHaveValue('');
    const suggested = Number(await holds.inputValue());
    expect(suggested).toBeGreaterThan(0);
    await noHorizontalOverflow(page);
    await panel.getByRole('button', { name: /Add coop or pen/ }).click();
    await expect
      .poll(async () => (await fields(page)).find((f) => f.name === 'Hen house')?.details)
      .toMatchObject({ capacity: suggested, capacityProvenance: 'data', speciesId: 'chicken' });
  });
});

test.describe('hydrant or waterer for several Areas (#478)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('Areas next to it start ticked, and each linked card and the map card say so', async ({
    page
  }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await page.setViewportSize({ width: 1280, height: 1100 });
    for (const [name, dx, dy] of [
      ['West pen', -70, -30],
      ['East pen', 10, -30],
      ['North field', -30, 300],
      ['South field', -30, -360]
    ] as const) {
      await post(page, '/api/fields', {
        name,
        kind: name.includes('pen') ? 'pasture' : 'field',
        geometryGeojson: square(dx, dy)
      });
    }
    await openMap(page);
    await page.getByRole('button', { name: '+ Add' }).click();
    await page
      .getByRole('dialog', { name: 'Add to map' })
      .getByRole('region', { name: 'Lines & points' })
      .getByRole('button', { name: /^Hydrant \/ Waterer/ })
      .click();
    await expect(page.getByText(/Tap the map where the hydrant \/ waterer is/)).toBeVisible();
    const map = page.locator('.leaflet-container');
    await map.scrollIntoViewIfNeeded();
    const box = (await map.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const modal = page.getByRole('dialog', { name: 'New hydrant / waterer' });
    await expect(modal).toBeVisible();
    await modal.getByLabel('Name').fill('Trough hydrant');
    const serves = modal.getByTestId('feature-serves');
    await expect(serves.getByLabel('West pen')).toBeChecked();
    await expect(serves.getByLabel('East pen')).toBeChecked();
    await expect(serves.getByLabel('North field')).not.toBeChecked();
    await serves.getByLabel('North field').check();
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toHaveCount(0);

    const all = await fields(page);
    const idOf = (n: string) => all.find((f) => f.name === n)!.id;
    await expect
      .poll(async () => (await features(page)).find((f) => f.name === 'Trough hydrant')?.areaIds)
      .toEqual(expect.arrayContaining([idOf('West pen'), idOf('East pen'), idOf('North field')]));

    const list = page.getByTestId('map-feature-list');
    await expect(list.getByRole('heading', { name: 'Hydrants / Waterers' })).toBeVisible();
    await expect(list.getByText(/Serves .*West pen/)).toBeVisible();

    const east = (await page.locator(`path[data-area-id="${idOf('East pen')}"]`).boundingBox())!;
    await page.mouse.click(east.x + east.width * 0.85, east.y + east.height / 2);
    const sheet = page.getByTestId('area-card-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Trough hydrant')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    await page.goto('/plan/farm-map');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Trough hydrant · serves .*East pen/).first()).toBeVisible();
  });
});

test.describe('plantings on the bed diagram and the printed card (#481)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('a scheduled planting with no spot shows dashed, then prints with its icon', async ({
    page
  }) => {
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await provisionWizardTenant(page, { blocks: [], seeds: [] });
    await page.setViewportSize({ width: 1280, height: 1000 });
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
    await page.goto(`/plan/areas/${area.field.id}/design?view=canvas`);
    const root = page.getByTestId('garden-designer');
    await expect(root).toHaveAttribute('data-ready', 'true');
    const year = Number(await root.getAttribute('data-season-year'));

    const made = await post<{ plantings: Array<{ cropId: string }> }>(
      page,
      '/api/garden/plantings',
      {
        plantings: [
          {
            blockId: bed.block.id,
            cropPluginId: 'tomato-celebrity-f1',
            varietyDisplayName: 'Tomato Celebrity',
            plantingDateMs: Date.UTC(year, 4, 15),
            footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 24 },
            spacingPattern: 'square',
            source: 'manual'
          }
        ]
      }
    );
    const unplace = await page.request.patch(`/api/crops/${made.plantings[0].cropId}`, {
      data: {
        action: 'set-placement',
        blockId: bed.block.id,
        footprint: null,
        spacingPattern: 'square'
      },
      headers: { origin: origin(page) }
    });
    expect(unplace.ok(), await unplace.text()).toBe(true);

    await page.reload();
    await expect(root).toHaveAttribute('data-ready', 'true');
    await page.getByRole('slider').fill(String(Date.UTC(year, 6, 15)));
    const fp = page.locator('[data-testid="footprint"]');
    await expect(fp).toHaveCount(1);
    await expect(fp).toHaveAttribute('data-placed', 'false');
    await expect(fp).toHaveAttribute('data-family-glyph', 'nightshade');
    await expect(fp).toHaveAttribute('aria-label', /Tomato Celebrity.*not placed yet/);
    await expect(fp.locator('path.glyph')).toHaveCount(1);

    await page.getByTestId('designer-print').click();
    await expect(page).toHaveURL(new RegExp(`/cards/area/[^?]+\\?on=${year}-07-15$`));
    const planting = page.getByTestId('bedmap-planting').first();
    await expect(planting).toBeVisible();
    await expect(planting).toHaveAttribute('data-glyph', 'nightshade');
    await expect(page.getByTestId('bedmap-legend').first()).toContainText(
      'Tomato Celebrity, not placed yet'
    );
    await expect(page.getByTestId('bedmap-legend').first()).toContainText(
      'Tomato and pepper family'
    );
  });

  test('a phone shows the crop name on a small footprint, not three letters', async ({ page }) => {
    await provisionWizardTenant(page, { blocks: [], seeds: [] });
    await page.setViewportSize({ width: 375, height: 800 });
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
    await page.goto(`/plan/areas/${area.field.id}/design?view=canvas`);
    await page.waitForLoadState('networkidle');
    const root = page.getByTestId('garden-designer');
    await expect(root).toHaveAttribute('data-ready', 'true');
    const year = Number(await root.getAttribute('data-season-year'));
    await post(page, '/api/garden/plantings', {
      plantings: [
        {
          blockId: bed.block.id,
          cropPluginId: 'tomato-celebrity-f1',
          varietyDisplayName: 'Tomato — Cherokee Purple (heirloom), grown from saved seed',
          plantingDateMs: Date.UTC(year, 4, 15),
          footprint: { x_in: 0, y_in: 0, w_in: 36, l_in: 18 },
          spacingPattern: 'square',
          source: 'manual'
        }
      ]
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(root).toHaveAttribute('data-ready', 'true');
    await page.getByRole('slider').fill(String(Date.UTC(year, 6, 15)));
    const label = page.getByTestId('footprint-label');
    await expect(label).toHaveCount(1);
    await expect(label).toHaveText('Tomato');
    await noHorizontalOverflow(page);
  });
});
