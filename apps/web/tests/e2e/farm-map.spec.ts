import type { Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { provisionWizardTenant } from './lib/wizardTenant';

// Phase 30D: the typed farm map. Add opens a drawer of Area kinds, the
// post-draw form is kind-aware, Filter is remembered per farm on this
// device, tapping an Area opens its card, and Export prints the Farm Map
// Card. Map tiles are stubbed, so drawing runs against a blank basemap.

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function addArea(page: Page, body: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/fields', {
    data: body,
    headers: { origin: origin(page) }
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { field: { id: string } }).field.id;
}

test.describe('typed farm map', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a garden sketched by size is a garden, with its own card', async ({ page }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await page.goto('/settings/farm/map');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Dimensions/ }).click();

    await page.getByRole('button', { name: '+ Add' }).click();
    const drawer = page.getByRole('dialog', { name: 'Add to map' });
    await expect(drawer.getByRole('heading', { name: 'Crop areas' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Other areas' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Shade & structures' })).toHaveCount(0);
    await drawer.getByRole('button', { name: /^Garden/ }).click();

    const form = page.getByTestId('sketch-add-field');
    await expect(form.getByRole('heading', { name: /Add a garden/ })).toBeVisible();
    await form.getByLabel('Name').fill('Kitchen Garden');
    await form.getByLabel('Width (ft)').fill('30');
    await form.getByLabel('Length (ft)').fill('40');
    await form.getByLabel('Watering').selectOption('drip');
    await form.getByRole('button', { name: 'Add garden' }).click();

    await expect(
      page.locator(
        '[data-testid="farm-sketch"] [data-field="Kitchen Garden"][data-area-kind="garden"]'
      )
    ).toBeVisible();

    await page.getByRole('button', { name: 'Open the card for Kitchen Garden' }).first().click();
    const sheet = page.getByTestId('area-card-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-area-kind', 'garden');
    await expect(sheet.getByText('Garden · 30×40 ft')).toBeVisible();
    await expect(sheet.getByText('Drip')).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Open designer' })).toHaveAttribute(
      'href',
      /^\/plan\/areas\/[^/]+\/design$/
    );

    await sheet.getByRole('tab', { name: /Plantings/ }).click();
    await expect(sheet.getByText('Nothing planted here yet.')).toBeVisible();
    await sheet.getByRole('tab', { name: /History/ }).click();
    await expect(sheet.getByText('No past plantings recorded here yet.')).toBeVisible();
  });

  test('drawing a greenhouse opens a kind-aware form with size and perimeter', async ({ page }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await page.goto('/settings/farm/map');
    await page.waitForLoadState('networkidle');

    const add = page.getByRole('button', { name: '+ Add' });
    await expect(add).toBeEnabled();
    await add.click();
    await page
      .getByRole('dialog', { name: 'Add to map' })
      .getByRole('button', { name: /^Greenhouse/ })
      .click();
    await expect(page.getByText(/Tap each corner of the greenhouse/)).toBeVisible();

    const map = page.locator('.leaflet-container');
    await page.setViewportSize({ width: 1280, height: 1100 });
    await map.scrollIntoViewIfNeeded();
    const box = (await map.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const corners: Array<[number, number]> = [
      [cx - 80, cy - 60],
      [cx + 80, cy - 60],
      [cx + 80, cy + 60],
      [cx - 80, cy + 60]
    ];
    for (const [x, y] of corners) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(150);
    }
    await page.mouse.click(corners[0][0], corners[0][1]);

    const modal = page.getByRole('dialog', { name: 'New greenhouse' });
    await expect(modal).toBeVisible();
    const measures = modal.getByTestId('draft-measures');
    await expect(measures.getByText('Size')).toBeVisible();
    await expect(measures.getByText('Perimeter')).toBeVisible();
    await expect(measures).toContainText(/≈ \d[\d,.]* ft/);
    await modal.getByLabel('Name').fill('High Tunnel');
    await modal.getByLabel('Structure').selectOption('high-tunnel');
    await modal.getByLabel('Heated').check();
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toHaveCount(0);

    const outline = page.locator('path[data-area-kind="greenhouse"]');
    await expect(outline).toHaveCount(1);
    await expect(outline).toHaveAttribute('stroke', '#6f8fa8');

    const res = await page.request.get('/api/fields?kind=greenhouse');
    const { fields } = (await res.json()) as {
      fields: Array<{ name: string; details: Record<string, unknown>; perimeterFt?: number }>;
    };
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      name: 'High Tunnel',
      details: { structure: 'high-tunnel', heated: true }
    });
    expect(fields[0].perimeterFt).toBeGreaterThan(0);

    await outline.click();
    const sheet = page.getByTestId('area-card-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('High tunnel', { exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Edit outline' })).toBeVisible();
  });

  test('the filter hides a kind and is remembered for this farm', async ({ page }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await addArea(page, { name: 'Kitchen Garden', kind: 'garden', widthFt: 30, lengthFt: 40 });
    await addArea(page, { name: 'Bank Barn', kind: 'barn', widthFt: 40, lengthFt: 60 });
    await page.goto('/settings/farm/map');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Dimensions/ }).click();

    const sketch = page.getByTestId('farm-sketch');
    await expect(sketch.locator('[data-area-kind="barn"]')).toBeVisible();

    await page.getByRole('button', { name: /^Filter/ }).click();
    const panel = page.getByTestId('map-filter');
    await panel.getByRole('checkbox', { name: /Barn/ }).uncheck();
    await page
      .getByRole('dialog', { name: 'Filter map' })
      .getByRole('button', { name: 'Close' })
      .click();

    await expect(sketch.locator('[data-area-kind="barn"]')).toHaveCount(0);
    await expect(sketch.locator('[data-area-kind="garden"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Filter (on)' })).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Dimensions/ }).click();
    await expect(page.getByTestId('farm-sketch').locator('[data-area-kind="barn"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Filter (on)' })).toBeVisible();
  });

  test('export prints the Farm Map Card', async ({ page }) => {
    await provisionWizardTenant(page, { blocks: [] });
    await addArea(page, { name: 'Kitchen Garden', kind: 'garden', widthFt: 30, lengthFt: 40 });
    await addArea(page, { name: 'Hayfield', kind: 'pasture', widthFt: 600, lengthFt: 700 });
    await page.goto('/settings/farm/map');
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: 'Export card' }).click();
    await expect(page).toHaveURL(/\/plan\/farm-map$/);

    const card = page.locator('article[data-card-kind="farmMap"][data-variant="screen"]');
    await expect(card).toBeVisible();
    await expect(card.getByText(/^Farm map · \d+ areas?$/)).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Gardens' })).toBeVisible();
    await expect(card.getByText('Kitchen Garden · 30×40 ft')).toBeVisible();
    await expect(card.getByText('Garden: sage')).toBeVisible();
    await expect(card.getByText('Last frost')).toBeVisible();
    await expect(
      page.getByTestId('farm-map-figure').locator('[data-area-kind="pasture"]')
    ).toHaveCount(1);

    const printed = page.locator('.card-print-sheet article[data-card-kind="farmMap"]');
    await expect(printed).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(printed).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
  });
});
