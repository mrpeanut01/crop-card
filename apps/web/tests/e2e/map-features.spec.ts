import type { Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { provisionWizardTenant } from './lib/wizardTenant';

// Phase 30H: map lines and points. The Add drawer's "Lines & points" group
// draws fences, irrigation lines and paths as lines and gates, water
// sources and hydrants as points; Filter hides them per kind; the Farm Map
// Card lists them and draws them in its figure. Tiles are stubbed, so
// drawing runs against a blank basemap.

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function openMap(page: Page) {
  await page.goto('/settings/farm/map');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: '+ Add' })).toBeEnabled();
}

async function pick(page: Page, label: RegExp) {
  await page.getByRole('button', { name: '+ Add' }).click();
  await page
    .getByRole('dialog', { name: 'Add to map' })
    .getByRole('region', { name: 'Lines & points' })
    .getByRole('button', { name: label })
    .click();
}

async function mapCenter(page: Page) {
  const map = page.locator('.leaflet-container');
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!;
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

type Feature = {
  id: string;
  kind: string;
  name: string;
  details: Record<string, unknown> | null;
  lengthFt: number | null;
};

async function listFeatures(page: Page): Promise<Feature[]> {
  const res = await page.request.get('/api/map-features');
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { mapFeatures: Feature[] }).mapFeatures;
}

test.describe('map lines and points', () => {
  test.describe.configure({ timeout: 150_000 });

  test('draw a fence and a water source, filter them, and see them on the card', async ({
    page
  }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await page.setViewportSize({ width: 1280, height: 1100 });
    await openMap(page);

    await pick(page, /^Fence/);
    await expect(page.getByText(/Tap along the fence/)).toBeVisible();
    await expect(page.locator('[data-hint]')).toHaveCount(0);
    const { cx, cy } = await mapCenter(page);
    await page.mouse.click(cx - 120, cy);
    await page.waitForTimeout(150);
    await page.mouse.click(cx + 20, cy - 40);
    await page.waitForTimeout(150);
    await page.mouse.click(cx + 120, cy);
    await page.waitForTimeout(150);
    await page.mouse.click(cx + 120, cy);

    const fenceModal = page.getByRole('dialog', { name: 'New fence' });
    await expect(fenceModal).toBeVisible();
    await expect(page.locator('[data-hint]')).toHaveCount(0);
    await expect(fenceModal.getByTestId('feature-draft-length')).toContainText(/≈ \d[\d,]* ft/);
    await fenceModal.getByLabel('Name').fill('Pasture fence');
    await fenceModal.getByRole('button', { name: 'Save' }).click();
    await expect(fenceModal).toHaveCount(0);
    await expect(page.locator('path.feature-fence')).toHaveCount(1);

    await pick(page, /^Water source/);
    await expect(page.getByText(/Tap the map where the water source is/)).toBeVisible();
    await page.mouse.click(cx, cy + 80);

    const wellModal = page.getByRole('dialog', { name: 'New water source' });
    await expect(wellModal).toBeVisible();
    await expect(wellModal.getByTestId('feature-draft-length')).toHaveCount(0);
    await wellModal.getByLabel('Name').fill('Barn well');
    await wellModal.getByLabel('Where the water comes from').selectOption('well');
    await wellModal.getByLabel(/Flow rate/).fill('12');
    await wellModal.getByRole('button', { name: 'Save' }).click();
    await expect(wellModal).toHaveCount(0);
    await expect(page.locator('.feature-pin[data-feature-kind="water_source"]')).toHaveCount(1);

    const saved = await listFeatures(page);
    expect(saved.map((f) => f.kind).sort()).toEqual(['fence', 'water_source']);
    const fence = saved.find((f) => f.kind === 'fence')!;
    expect(fence.name).toBe('Pasture fence');
    expect(fence.lengthFt).toBeGreaterThan(0);
    expect(saved.find((f) => f.kind === 'water_source')).toMatchObject({
      name: 'Barn well',
      details: { source: 'well', flowRateGpm: 12 }
    });

    const list = page.getByTestId('map-feature-list');
    await expect(list.getByRole('heading', { name: 'Fences' })).toBeVisible();
    await expect(list.getByText('Barn well · Well, 12 gal/min')).toBeVisible();

    await page.getByRole('button', { name: /^Filter/ }).click();
    const panel = page.getByTestId('map-filter');
    await expect(panel.getByText('Lines & points')).toBeVisible();
    await panel.getByRole('checkbox', { name: /Fences/ }).uncheck();
    await page
      .getByRole('dialog', { name: 'Filter map' })
      .getByRole('button', { name: 'Close' })
      .click();
    await expect(page.locator('path.feature-fence')).toHaveCount(0);
    await expect(page.locator('.feature-pin[data-feature-kind="water_source"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Filter (on)' })).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.feature-pin[data-feature-kind="water_source"]')).toHaveCount(1);
    await expect(page.locator('path.feature-fence')).toHaveCount(0);

    await page.getByRole('link', { name: 'Export card' }).click();
    await expect(page).toHaveURL(/\/plan\/farm-map$/);
    const card = page.locator('article[data-card-kind="farmMap"][data-variant="screen"]');
    await expect(card.getByRole('heading', { name: 'Fences' })).toBeVisible();
    await expect(card.getByText(/^Pasture fence · \d[\d,]* ft$/)).toBeVisible();
    await expect(card.getByText('Barn well · Well, 12 gal/min')).toBeVisible();
    await expect(card.getByText('Fence: brown line')).toBeVisible();
    await expect(card.getByText('Water source: blue dot marked W')).toBeVisible();
    const figure = page.getByTestId('farm-map-figure');
    await expect(figure.locator('polyline[data-feature-kind="fence"]')).toHaveCount(1);
    await expect(figure.locator('g[data-feature-kind="water_source"]')).toHaveCount(1);
    await expect(figure.locator('[data-legend-feature="fence"]')).toBeVisible();
  });

  test('edit and remove from the list, and fit a phone screen', async ({ page }) => {
    await provisionWizardTenant(page, { blocks: [] });
    for (const body of [
      {
        kind: 'hydrant',
        name: 'Garden hydrant',
        geometry: { type: 'Point', coordinates: [-77.55, 39.1] }
      },
      {
        kind: 'irrigation_line',
        name: 'Main drip line',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-77.551, 39.1],
            [-77.549, 39.1]
          ]
        }
      }
    ]) {
      const res = await page.request.post('/api/map-features', {
        data: body,
        headers: { origin: origin(page) }
      });
      expect(res.status(), await res.text()).toBe(201);
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await openMap(page);
    const list = page.getByTestId('map-feature-list');
    await expect(list.getByRole('heading', { name: 'Hydrants' })).toBeVisible();
    await expect(list.getByRole('heading', { name: 'Irrigation lines' })).toBeVisible();

    const editBtn = list.getByRole('button', { name: 'Edit Garden hydrant' });
    const box = (await editBtn.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    await editBtn.click();
    const form = list.getByRole('form', { name: 'Edit hydrant' });
    await form.getByLabel('Name').fill('Barn hydrant');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(list.getByText('Barn hydrant')).toBeVisible();

    page.once('dialog', (d) => void d.accept());
    await list.getByRole('button', { name: 'Remove Main drip line' }).click();
    await expect(list.getByRole('heading', { name: 'Irrigation lines' })).toHaveCount(0);
    expect((await listFeatures(page)).map((f) => f.name)).toEqual(['Barn hydrant']);

    await page.getByRole('button', { name: '+ Add' }).click();
    const drawer = page.getByRole('dialog', { name: 'Add to map' });
    await expect(drawer.getByRole('region', { name: 'Lines & points' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('shows a point name as plain text and gives the pin a glove-sized target', async ({
    page
  }) => {
    await provisionWizardTenant(page, { blocks: [] });
    let dialogs = 0;
    page.on('dialog', (d) => {
      dialogs++;
      void d.dismiss();
    });
    const res = await page.request.post('/api/map-features', {
      data: {
        kind: 'gate',
        name: '<img src=x onerror=alert(1)><b>Back</b> gate',
        geometry: { type: 'Point', coordinates: [-77.55, 39.1] }
      },
      headers: { origin: origin(page) }
    });
    expect(res.status(), await res.text()).toBe(201);

    await page.setViewportSize({ width: 375, height: 800 });
    await openMap(page);
    const pin = page.locator('.feature-pin[data-feature-kind="gate"]');
    await expect(pin).toHaveCount(1);
    const box = (await pin.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const hit = await page.evaluate(
      ([x, y]) =>
        [
          [x + 22, y],
          [x - 22, y],
          [x, y + 22],
          [x, y - 22]
        ].map(([px, py]) => !!document.elementFromPoint(px, py)?.closest('.feature-pin')),
      [cx, cy]
    );
    expect(hit).toEqual([true, true, true, true]);

    await page.mouse.move(cx, cy);
    const tip = page.locator('.leaflet-tooltip');
    await expect(tip).toHaveText('Gate: <img src=x onerror=alert(1)><b>Back</b> gate');
    await expect(tip.locator('b, img')).toHaveCount(0);
    expect(dialogs).toBe(0);
  });
});
