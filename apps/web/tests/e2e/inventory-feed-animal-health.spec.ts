import { expect, test } from './lib/test';
import type { Page } from '@playwright/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

async function openInventory(page: Page, query = ''): Promise<void> {
  await page.goto(`/inventory${query}`);
  await page.waitForLoadState('networkidle');
}

const typeTabs = (page: Page) =>
  page.getByRole('tablist', { name: 'Inventory type' }).getByRole('tab');

test('feed and animal-health chips appear with animals, and feed is used by the scoop', async ({
  page,
  browser
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await provisionEmptyFarm(page);

  await openInventory(page);
  await expect(typeTabs(page)).toHaveCount(4);
  await expect(page.getByRole('tab', { name: /Feed & bedding/ })).toHaveCount(0);

  const flock = await page.request.post('/api/animal-groups', {
    data: { name: 'Layers', speciesId: 'chicken', headCount: 12 },
    headers: { origin: originOf(page) }
  });
  expect(flock.ok(), await flock.text()).toBe(true);

  await openInventory(page);
  await expect(typeTabs(page)).toHaveCount(6);
  await expect(page.getByRole('tab', { name: /Feed & bedding/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Animal health/ })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.getByRole('tab', { name: /Feed & bedding/ }).click();
  await page.waitForURL(/type=feed/);
  await expect(page.getByRole('group', { name: /Stock vs catalog/ })).toHaveCount(0);
  await page.getByRole('link', { name: /Add feed or bedding/ }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: /Type it in/ }).click();

  await page.getByLabel('This feed is medicated').check();
  await expect(page.getByTestId('medicated-refusal')).toContainText(
    'add it as animal-health stock'
  );
  await expect(page.getByRole('button', { name: /Create feed or bedding/ })).toBeDisabled();
  await page.getByLabel('This feed is medicated').uncheck();

  await page.getByLabel(/Display name/).fill('Layer pellets');
  await page.getByLabel('Pounds in one bag').fill('50');
  await page.getByLabel('One scoop (lb)').fill('2');
  await page.getByLabel(/How much do you have/).fill('2');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: /Create feed or bedding/ }).click();
  await page.waitForURL(/\/inventory\?type=feed$/);
  await page.waitForLoadState('networkidle');

  const items = (await (await page.request.get('/api/stock')).json()) as {
    items: { id: string; displayName: string; category: string; onHand: number }[];
  };
  const pellets = items.items.find((i) => i.displayName === 'Layer pellets')!;
  expect(pellets.category).toBe('feed');
  expect(pellets.onHand).toBe(2);

  const helper = await provisionHelper(page, browser);
  await helper.setViewportSize({ width: 375, height: 800 });
  await helper.goto(`/inventory/feed/${pellets.id}`);
  await helper.waitForLoadState('networkidle');
  await expect(helper.getByTestId('feed-on-hand')).toContainText('2 bags');
  await expect(helper.getByTestId('feed-on-hand')).toContainText('100 lb');
  await helper.getByTestId('feed-subject').selectOption({ label: 'Layers' });
  await helper.getByRole('button', { name: /^1 scoop/ }).click();
  await expect(helper.getByText('Used 2 lb.')).toBeVisible();
  await expect(helper.getByTestId('feed-on-hand')).toContainText('1.96 bags');
  await expect(helper.getByTestId('feed-on-hand')).toContainText('98 lb');
  await expect(helper.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  expect(await horizontalOverflow(helper)).toBeLessThanOrEqual(0);

  await helper.getByTestId('feed-use-lb').fill('3');
  await helper.getByRole('button', { name: 'Record use' }).click();
  await expect(helper.getByTestId('feed-on-hand')).toContainText('1.9 bags');

  const detail = (await (await page.request.get(`/api/stock/${pellets.id}`)).json()) as {
    movements: { reason: string; notes?: string }[];
  };
  const fed = detail.movements.filter((mv) => mv.reason === 'animal-feed');
  expect(fed).toHaveLength(2);
  expect(fed.some((mv) => mv.notes?.startsWith('animal-feed:group:'))).toBe(true);
  await helper.context().close();
});

test('a medicine is saved by hand with its NADA number and no withdrawal from any scan', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await provisionEmptyFarm(page);

  await openInventory(page, '?type=animal-health');
  await expect(page.getByRole('tab', { name: /Animal health/ })).toBeVisible();
  await page.getByRole('button', { name: 'Catalog' }).click();
  await page.waitForURL(/mode=catalog/);
  await expect(page.getByTestId('animal-health-catalog-empty')).toBeVisible();

  await page.goto('/inventory/animal-health/add');
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: /Scan label/ }).click();
  await expect(page.getByText(/Claude key required/)).toBeVisible();
  await page.getByRole('tab', { name: /Type it in/ }).click();

  await expect(page.getByTestId('no-health-library')).toBeVisible();
  await page.getByLabel(/Display name/).fill('Poultry dewormer');
  await page.getByLabel('NADA or ANADA number').fill('nada 141-061');
  await page.getByLabel(/How much do you have/).fill('100');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: /Create medicine/ }).click();
  await page.waitForURL(/\/inventory\?type=animal-health$/);
  await page.waitForLoadState('networkidle');

  const items = (await (await page.request.get('/api/stock')).json()) as {
    items: { id: string; displayName: string; category: string; defaultUnit: string }[];
  };
  const bottle = items.items.find((i) => i.displayName === 'Poultry dewormer')!;
  expect(bottle.category).toBe('animal-health');
  expect(bottle.defaultUnit).toBe('ml');

  await page.goto(`/inventory/animal-health/${bottle.id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('nada')).toContainText('NADA 141-061');
  await expect(page.getByTestId('withdrawal-unknown')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
