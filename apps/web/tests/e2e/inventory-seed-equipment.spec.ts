import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';

// #472 crop category picker, #473 seed quantity, #474 sprayers under Equipment.

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

async function openManualSeedForm(page: Page): Promise<void> {
  await page.goto('/inventory/seed/add');
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: /Type it in/ }).click();
  await expect(page.locator('#displayName')).toBeVisible();
}

test.describe('seed inventory', () => {
  test('a typed seed name auto-matches its crop category, saves a quantity, and edits it', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    await openManualSeedForm(page);

    await page.locator('#displayName').fill('Cherokee Purple Heirloom Tomato Seeds');
    const current = page.getByTestId('pluginId-current');
    await expect(current).toContainText('Cherokee Purple');
    await expect(current.locator('[data-provenance="data"]')).toBeVisible();
    await expect(page.getByText('Plugin id')).toHaveCount(0);

    const unit = page.locator('#defaultUnit');
    await expect(unit).toHaveValue('seeds');
    await expect(unit.locator('option')).toHaveText(['Seeds', 'Plants', 'oz', 'lb', 'g']);

    await page.locator('#quantity').fill('250');
    await page.locator('#lotNumber').fill('CP-1');
    await page.getByRole('button', { name: 'Create seed' }).click();
    await expect(page).toHaveURL(/\/inventory\?type=seed$/);

    const items = (await (await page.request.get('/api/stock')).json()) as {
      items: Array<{ id: string; category: string; pluginId?: string; defaultUnit: string }>;
    };
    const seed = items.items.find((i) => i.category === 'seed');
    expect(seed?.pluginId).toBe('tomato-cherokee-purple');
    expect(seed?.defaultUnit).toBe('seeds');

    await page.goto(`/inventory/seed/${seed!.id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('250 seeds').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Crop category' })).toBeVisible();

    await page.getByRole('link', { name: 'Edit' }).click();
    await page.waitForLoadState('networkidle');
    const qty = page.locator('#quantity');
    await expect(qty).toHaveValue('250');
    await expect(page.locator('#defaultUnit')).toBeDisabled();
    await qty.fill('200');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/inventory\?type=seed$/);

    await page.goto(`/inventory/seed/${seed!.id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('200 seeds').first()).toBeVisible();
    await expect(page.getByText('adjustment')).toBeVisible();
  });

  test('the category can be changed through type-ahead, and is required', async ({ page }) => {
    await provisionEmptyFarm(page);
    await openManualSeedForm(page);

    await page.locator('#displayName').fill('Zzqx');
    await expect(page.getByTestId('pluginId-current')).toHaveCount(0);
    await page.getByRole('button', { name: 'Create seed' }).click();
    await expect(page.getByText('Pick a crop category for this seed')).toBeVisible();

    const box = page.getByRole('combobox', { name: /Category/ });
    await box.fill('genov');
    await page.getByRole('option', { name: /Basil/ }).click();
    const current = page.getByTestId('pluginId-current');
    await expect(current).toContainText('Basil');
    await expect(current.locator('[data-provenance="manual"]')).toBeVisible();

    await page.getByRole('button', { name: 'Create seed' }).click();
    await expect(page).toHaveURL(/\/inventory\?type=seed$/);
  });

  test('a pesticide with no linked product label says its safety data is missing', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    const { item } = await post<{ item: { id: string } }>(page, '/api/stock', {
      category: 'herbicide',
      displayName: 'Mystery weed killer',
      defaultUnit: 'fl-oz'
    });
    await page.goto(`/inventory/pesticide/${item.id}`);
    await page.waitForLoadState('networkidle');
    const note = page.getByTestId('no-product-link');
    await expect(note).toContainText('No product label linked');
    await expect(note).toContainText('safety checks cannot use');
    await expect(page.getByText(/plugin/i)).toHaveCount(0);
  });
});

test.describe('equipment (#474)', () => {
  test('sprayers live under Equipment, reachable from the top menu, and old links redirect', async ({
    page
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await provisionEmptyFarm(page);

    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('tab', { name: /Sprayers/ })).toHaveCount(0);

    const nav = page.getByRole('navigation', { name: 'Primary' });
    await nav.locator('details[data-group="farm"] > summary').click();
    await nav.getByRole('link', { name: 'Equipment' }).click();
    await expect(page).toHaveURL(/\/equipment$/);
    await expect(page.getByRole('heading', { name: 'Equipment', level: 1 })).toBeVisible();

    await page.goto('/inventory/sprayer/add');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/equipment\?add=sprayer$/);
    await expect(page.getByLabel('Type', { exact: true })).toHaveValue('Sprayer');
    await page.getByLabel('Name', { exact: true }).fill('Backpack 4');
    await page.getByLabel('Tank size in gallons').fill('4');
    await page.getByLabel('Nozzle').fill('TeeJet XR110015');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const link = page.getByRole('link', { name: 'Backpack 4' });
    await expect(link).toBeVisible();

    const res = await page.request.get('/api/equipment?type=sprayer');
    const { equipment } = (await res.json()) as {
      equipment: Array<{ id: string; spec?: { tankGal?: number; nozzle?: string } }>;
    };
    expect(equipment[0].spec).toMatchObject({ tankGal: 4, nozzle: 'TeeJet XR110015' });
    const id = equipment[0].id;

    await page.goto(`/inventory/sprayer/${id}`);
    await expect(page).toHaveURL(new RegExp(`/equipment/${id}$`));
    await page.goto(`/inventory/sprayer/${id}/edit`);
    await expect(page).toHaveURL(new RegExp(`/equipment/${id}$`));
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('TeeJet XR110015')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Calibrate' })).toHaveAttribute(
      'href',
      `/calibrate?sprayer=${id}`
    );

    await page.getByRole('button', { name: 'Add notes' }).click();
    await page.getByLabel('Notes').fill('Keep the wand in the shed');
    await page.getByRole('button', { name: 'Save notes' }).click();
    await expect(page.getByText('Keep the wand in the shed')).toBeVisible();

    await page.getByRole('button', { name: 'Edit tank and nozzle' }).click();
    const specForm = page.getByTestId('sprayer-spec-edit');
    await specForm.getByLabel('Tank size (gallons)').fill('3');
    await specForm.getByLabel('Nozzle').fill('TeeJet 8002');
    await page.getByRole('button', { name: 'Save tank and nozzle' }).click();
    await expect(page.getByText('TeeJet 8002')).toBeVisible();
    const after = await page.request.get(`/api/equipment/${id}`);
    expect(
      ((await after.json()) as { equipment: { spec?: unknown } }).equipment.spec
    ).toMatchObject({ tankGal: 3, nozzle: 'TeeJet 8002' });

    const second = await page.request.post('/api/equipment', {
      data: { type: 'sprayer', label: 'Aaa first sprayer' },
      headers: { origin: new URL(page.url()).origin }
    });
    expect(second.status()).toBe(201);
    await page.getByRole('link', { name: 'Calibrate' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByLabel('Choose sprayer')).toHaveValue(id);

    await page.goto('/inventory?type=sprayer');
    await expect(page).toHaveURL(/\/equipment$/);
  });

  test('Equipment is in the phone menu with no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await provisionEmptyFarm(page);
    await page.goto('/equipment');
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await nav.locator('details[data-group="farm"] > summary').click();
    await nav.getByRole('link', { name: 'Equipment' }).click();
    await expect(page).toHaveURL(/\/equipment$/);
  });

  test('the phone add form has visible labels, sprayer fields above Add, and 48px targets', async ({
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await provisionEmptyFarm(page);
    await post(page, '/api/equipment', { type: 'sprayer', label: 'Sprayer-Contaminated' });
    await page.goto('/equipment');
    await page.waitForLoadState('networkidle');
    const add = page.locator('#add');
    await add.getByLabel('Type', { exact: true }).fill('Sprayer');
    for (const text of ['Type', 'Name', 'Tank size in gallons (optional)', 'Nozzle (optional)']) {
      await expect(add.getByText(text, { exact: true })).toBeVisible();
    }
    const nozzle = await add.getByLabel('Nozzle').boundingBox();
    const button = await add.getByRole('button', { name: 'Add', exact: true }).boundingBox();
    expect(nozzle && button && nozzle.y < button.y).toBe(true);
    const link = await page.getByRole('link', { name: 'Sprayer-Contaminated' }).boundingBox();
    expect(link?.height).toBeGreaterThanOrEqual(48);
    const inv = await page.locator('.lede').getByRole('link', { name: 'Inventory' }).boundingBox();
    expect(inv?.height).toBeGreaterThanOrEqual(48);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('inventory at phone width (wave 1 review)', () => {
  test('Create seed is tappable above the bottom nav, and Equipment and Edit are 48px', async ({
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await provisionEmptyFarm(page);

    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');
    const equipment = page.locator('.lede a', { hasText: 'Equipment' });
    expect((await equipment.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);

    await openManualSeedForm(page);
    await page.locator('#displayName').fill('Cherokee Purple Heirloom Tomato Seeds');
    await page.locator('#quantity').fill('50');
    const create = page.getByRole('button', { name: 'Create seed' });
    const box = await create.boundingBox();
    const nav = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
    expect(box && nav).toBeTruthy();
    expect(box!.y + box!.height).toBeLessThanOrEqual(nav!.y + 1);
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.textContent?.trim() ?? '',
      [box!.x + box!.width / 2, box!.y + box!.height / 2]
    );
    expect(hit).toBe('Create seed');
    await create.click();
    await expect(page).toHaveURL(/\/inventory\?type=seed$/);

    const items = (await (await page.request.get('/api/stock')).json()) as {
      items: Array<{ id: string; category: string }>;
    };
    const seed = items.items.find((i) => i.category === 'seed')!;
    await page.goto(`/inventory/seed/${seed.id}`);
    await page.waitForLoadState('networkidle');
    const edit = page.getByRole('link', { name: 'Edit', exact: true });
    const editBox = await edit.boundingBox();
    expect(editBox?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect(editBox?.width ?? 0).toBeGreaterThanOrEqual(48);
  });
});
