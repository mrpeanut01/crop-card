import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';

// Phase 30G: Cards on /plan, /inventory and /records.

const PHONE = { width: 375, height: 800 };
const DESKTOP = { width: 1280, height: 900 };
const DAY = 86_400_000;

function originOf(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

interface Farm {
  fieldId: string;
  gardenId: string;
  northId: string;
  bedId: string;
  cornId: string;
  tomatoId: string;
}

async function seedFarm(page: Page): Promise<Farm> {
  await provisionEmptyFarm(page);
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'North field',
    kind: 'field',
    acres: 3
  });
  const { field: garden } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Kitchen garden',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  const { block: north } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'North 3',
    acres: 3,
    fieldId: field.id
  });
  const { block: bed } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Bed 1',
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    fieldId: garden.id
  });
  const corn = await post<{ planting?: { id: string }; id?: string }>(
    page,
    `/api/blocks/${north.id}/plantings`,
    { cropPluginId: 'corn-sweet-bodacious', plantingDate: Date.now() - 10 * DAY }
  );
  const tomato = await post<{ planting?: { id: string }; id?: string }>(
    page,
    `/api/blocks/${bed.id}/plantings`,
    { cropPluginId: 'tomato-cherokee-purple', plantingDate: Date.now() - 5 * DAY }
  );
  return {
    fieldId: field.id,
    gardenId: garden.id,
    northId: north.id,
    bedId: bed.id,
    cornId: corn.planting?.id ?? corn.id ?? '',
    tomatoId: tomato.planting?.id ?? tomato.id ?? ''
  };
}

test.describe('cards everywhere', () => {
  test.describe.configure({ timeout: 120_000 });

  test('/plan: Area cards in the rail, then Block cards, then Planting cards', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const farm = await seedFarm(page);
    await page.goto('/plan?setup=skip');
    await page.waitForLoadState('networkidle');

    const rail = page.getByTestId('plan-area-cards');
    await expect(rail.locator('article[data-card-kind="area"]')).toHaveCount(2);
    await expect(page.getByText('Areas · 2')).toBeVisible();
    await expect(rail.locator('a[aria-current="true"]')).toHaveCount(1);

    await page.goto(`/plan?setup=skip&field=${farm.fieldId}`);
    await page.waitForLoadState('networkidle');
    const north = rail.locator(`[data-area-id="${farm.fieldId}"]`);
    await expect(north).toContainText('Bodacious');
    await expect(north.getByRole('link', { name: 'North field' })).toHaveAttribute(
      'aria-current',
      'true'
    );

    const blocks = page.getByTestId('plan-block-cards');
    await expect(blocks.getByRole('link', { name: 'North 3' })).toHaveAttribute(
      'aria-current',
      'true'
    );
    const planting = page.locator('article[data-card-kind="planting"]').first();
    await expect(planting).toBeVisible();
    await expect(planting.locator('[data-card-status]')).toHaveText('active');
    await expect(planting.locator('dt')).toHaveText([
      'Role',
      'Stage',
      'Planted',
      'Harvest',
      'Amount'
    ]);
    await expect(page.getByRole('button', { name: /Add planting/ }).first()).toBeVisible();

    const garden = rail.locator(`[data-area-id="${farm.gardenId}"]`);
    await expect(garden.getByRole('link', { name: 'Open designer' })).toHaveAttribute(
      'href',
      `/plan/areas/${farm.gardenId}/design`
    );
    await garden.getByRole('link', { name: 'Kitchen garden' }).click();
    await expect(page).toHaveURL(new RegExp(`field=${farm.gardenId}`));
    const view = page.getByTestId('plan-area-view');
    await expect(view.getByTestId('card-bed-map')).toBeVisible();
    await expect(view.getByRole('link', { name: 'Open designer' })).toBeVisible();
    await expect(
      page.getByTestId('plan-block-cards').getByRole('link', { name: 'Bed 1' })
    ).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('article[data-card-kind="planting"]').first()).toContainText(
      'Cherokee Purple'
    );

    await page.getByRole('searchbox', { name: /Filter Areas/ }).fill('bodacious');
    await expect(rail.locator('article')).toHaveCount(1);
    await expect(rail.locator(`[data-area-id="${farm.fieldId}"]`)).toBeVisible();
  });

  test('/plan at 375px keeps the cards inside the screen with 48px targets', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await seedFarm(page);
    await page.goto('/plan?setup=skip');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('plan-area-cards').locator('article').first()).toBeVisible();
    await noHorizontalOverflow(page);
    const link = page.getByTestId('plan-block-cards').locator('a').first();
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  });

  test('/inventory: phone cards, desktop table, one chrome and the same detail links', async ({
    page,
    browser
  }) => {
    await provisionEmptyFarm(page);
    await post(page, '/api/equipment', { type: 'sprayer', label: 'Pull 50' });
    const { item } = await post<{ item: { id: string } }>(page, '/api/stock', {
      category: 'herbicide',
      displayName: 'Roundup PowerMAX',
      defaultUnit: 'gal'
    });
    await post(page, `/api/stock/${item.id}/lots`, { receivedQuantity: 2, unit: 'gal' });

    await page.setViewportSize(PHONE);
    await page.goto('/inventory?type=pesticide');
    await page.waitForLoadState('networkidle');
    const cards = page.getByTestId('inventory-cards');
    await expect(cards).toBeVisible();
    await expect(page.locator('table.inv-table')).toBeHidden();
    await expect(page.getByRole('tablist', { name: 'Inventory type' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Stock vs catalog' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'At-a-glance metrics' })).toBeVisible();
    const card = cards.locator('article[data-card-kind="stock"]');
    await expect(card).toHaveCount(1);
    await expect(card.locator('dt')).toHaveText(['Category', 'On hand', 'Lots', 'Expires']);
    await noHorizontalOverflow(page);

    await page.getByRole('searchbox', { name: 'Search inventory' }).fill('zzz');
    await expect(cards).toContainText('Nothing matches that search.');
    await page.getByRole('searchbox', { name: 'Search inventory' }).fill('round');
    await cards.getByRole('link', { name: 'Roundup PowerMAX' }).click();
    await expect(page).toHaveURL(new RegExp(`/inventory/pesticide/${item.id}$`));

    await page.goto('/inventory?type=sprayer');
    const sprayer = page
      .getByTestId('inventory-cards')
      .locator('article[data-card-kind="equipment"]');
    await expect(sprayer).toContainText('Pull 50');
    await expect(sprayer.locator('[data-card-status]')).toHaveText('New');

    await page.setViewportSize(DESKTOP);
    await page.goto('/inventory?type=pesticide');
    await expect(page.locator('table.inv-table')).toBeVisible();
    await expect(page.getByTestId('inventory-cards')).toBeHidden();

    const helper = await provisionHelper(page, browser);
    await helper.setViewportSize(PHONE);
    await helper.goto('/inventory?type=pesticide');
    await expect(
      helper.getByTestId('inventory-cards').getByRole('link', { name: 'Roundup PowerMAX' })
    ).toBeVisible();
    await helper.context().close();
  });

  test('/records: a row expands into its card and prints it', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const farm = await seedFarm(page);
    await post(page, '/api/scout/record', {
      blockId: farm.northId,
      pest: 'Corn earworm',
      metric: 'per_plant',
      value: 2,
      notes: 'Silks on the east edge'
    });
    await page.goto('/records');
    await page.waitForLoadState('networkidle');

    const scoutToggle = page.getByRole('button', { name: /^Card: Scout record from/ });
    await expect(scoutToggle).toHaveAttribute('aria-expanded', 'false');
    await scoutToggle.click();
    await expect(scoutToggle).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByTestId('record-card-panel').first();
    const scoutCard = panel.locator('article[data-card-kind="scout"]');
    await expect(scoutCard).toBeVisible();
    await expect(scoutCard.getByRole('heading', { name: 'Corn earworm' })).toBeVisible();
    await expect(scoutCard).toContainText('Silks on the east edge');
    await expect(scoutCard).toContainText('Read-only copy of a saved record');

    await page.evaluate(() => {
      (window as unknown as { printed: number }).printed = 0;
      window.print = () => {
        (window as unknown as { printed: number }).printed += 1;
      };
    });
    await panel.getByLabel('Paper').selectOption('letter-4up');
    await panel.getByRole('button', { name: 'Print card' }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed))
      .toBe(1);
    await page.emulateMedia({ media: 'print' });
    const sheet = page.locator('.card-print-sheet');
    await expect(
      sheet.locator('article[data-variant="print"][data-card-kind="scout"]')
    ).toHaveCount(1);
    await expect(sheet.locator('.records-page')).toHaveCount(0);
    await expect(page.locator('.records-page')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('.card-print-sheet')).toHaveCount(0);

    await scoutToggle.click();
    await expect(page.getByTestId('record-card-panel')).toHaveCount(0);

    const plantingToggle = page
      .getByRole('button', { name: /^Card: Planting record from/ })
      .first();
    await plantingToggle.click();
    const plantingCard = page
      .getByTestId('record-card-panel')
      .locator('article[data-card-kind="planting"]');
    await expect(plantingCard).toBeVisible();
    await expect(plantingCard.getByRole('link', { name: 'Open full record' })).toBeVisible();
  });

  test('/records at 375px: an expanded card fits the screen', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const farm = await seedFarm(page);
    await post(page, '/api/scout/record', {
      blockId: farm.northId,
      pest: 'Aphids',
      metric: 'per_plant',
      value: 5
    });
    await page.goto('/records');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^Card: Scout record from/ }).click();
    const card = page.getByTestId('record-card-panel').locator('article');
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    await noHorizontalOverflow(page);
  });

  test('/records: a fungicide record opens as a read-only Spray Card reference', async ({
    page
  }) => {
    await page.setViewportSize(DESKTOP);
    const farm = await seedFarm(page);
    expect(farm.tomatoId).not.toBe('');
    await post(page, '/api/fungicide/record', {
      blockId: farm.bedId,
      cropId: farm.tomatoId,
      productPluginIds: ['champ-dp'],
      conditions: { windMph: 4, tempF: 70, rainForecastMmNext24h: 0 }
    });
    await page.goto('/records');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^Card: Fungicide record from/ }).click();
    const card = page.getByTestId('record-card-panel').locator('article[data-card-kind="spray"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Fungicide record · Bed 1');
    await expect(card).toContainText('Reference, not a clearance');
    await expect(card).toContainText('Recheck weather, REI and label before spraying.');
    await expect(card).toContainText('Label facts');
    await expect(card.locator('.rules')).toContainText('Rules');
    await expect(card.getByRole('link', { name: /Record this spray/ })).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Open full record' })).toHaveAttribute(
      'href',
      /^\/records\/fungicide\//
    );
  });
});
