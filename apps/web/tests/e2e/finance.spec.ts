import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 32F (F2): the owner-only money ledger, the Season Profit Card,
// "Record a sale" after a harvest and "Record purchase as expense".

async function post(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return res.json();
}

async function applePlanting(page: Page): Promise<{ blockId: string }> {
  const { block } = (await post(page, '/api/blocks', { name: 'Orchard row' })) as {
    block: { id: string };
  };
  await post(page, `/api/blocks/${block.id}/plantings`, {
    cropPluginId: 'apple-orchard',
    plantingDate: Date.now() - 400 * 86_400_000
  });
  return { blockId: block.id };
}

async function addEntry(
  page: Page,
  button: 'Add expense' | 'Add income',
  fill: { amount: string; description?: string; link?: RegExp }
) {
  await page.getByRole('link', { name: button }).click();
  await expect(page).toHaveURL(/\/finance\/new\?/);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Amount in dollars').fill(fill.amount);
  if (fill.description) await page.getByLabel(/What was it\?/).fill(fill.description);
  if (fill.link) {
    const select = page.getByLabel(/Linked to/);
    const value = await select
      .locator('option', { hasText: fill.link })
      .first()
      .getAttribute('value');
    await select.selectOption(value!);
  }
  await page.getByRole('button', { name: /^Save (expense|income)$/ }).click();
  await expect(page).toHaveURL(/\/finance\?year=\d{4}$/);
  await page.waitForLoadState('networkidle');
}

test.describe('money (F2)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('an owner adds, edits, deletes and restores entries, and the totals follow', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    await applePlanting(page);
    await page.goto('/finance');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /^Money for \d{4}\.$/ })).toBeVisible();
    await expect(page.getByText(/No entries for \d{4} yet\./)).toBeVisible();

    await addEntry(page, 'Add expense', { amount: '25.50', description: 'Twine and stakes' });
    await expect(page.getByTestId('net-cash')).toHaveText('-$25.50');

    await addEntry(page, 'Add income', {
      amount: '120',
      description: 'Apples at market',
      link: /Apple/
    });
    await expect(page.getByTestId('net-cash')).toHaveText('$94.50');
    const apples = page.getByTestId('ledger-entry').filter({ hasText: 'Apples at market' });
    await expect(apples).toContainText('Crop:');

    const twine = page.getByTestId('ledger-entry').filter({ hasText: 'Twine and stakes' });
    await twine.getByRole('link', { name: 'Edit' }).click();
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Amount in dollars').fill('30');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/finance\?year=/);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('net-cash')).toHaveText('$90.00');

    await apples.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('net-cash')).toHaveText('-$30.00');
    await page.getByRole('link', { name: 'Deleted', exact: true }).click();
    await page.waitForLoadState('networkidle');
    const deleted = page.getByTestId('ledger-entry').filter({ hasText: 'Apples at market' });
    await deleted.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByTestId('ledger-entry')).toHaveCount(0);
    await page.getByRole('link', { name: 'Entries', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('net-cash')).toHaveText('$90.00');

    const year = new Date().getFullYear();
    const csv = await page.request.get(`/api/finance/export.csv?year=${year}`);
    expect(csv.headers()['content-type']).toContain('text/csv');
    const text = await csv.text();
    expect(text).toContain('date,kind,category,amount,description');
    expect(text).toContain('Twine and stakes');
    expect(text).toContain('120.00');

    await page.getByRole('link', { name: 'Season profit card' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(new RegExp(`/finance/profit/${year}$`));
    await expect(page.getByRole('heading', { name: `Season profit, ${year}.` })).toBeVisible();
    await expect(page.locator('.no-print').getByText('Net cash')).toBeVisible();

    await page.goto(`/c/pf_${year}`);
    await expect(page).toHaveURL(new RegExp(`/finance/profit/${year}$`));
  });

  test('a helper gets 403 on money and never sees the Money tile', async ({ page, browser }) => {
    await provisionEmptyFarm(page);
    const helper = await provisionHelper(page, browser);
    const res = await helper.goto('/finance');
    expect(res?.status()).toBe(403);
    const api = await helper.request.get('/api/finance/entries');
    expect(api.status()).toBe(403);
    await helper.goto('/settings');
    await helper.waitForLoadState('networkidle');
    await expect(helper.getByRole('link', { name: /Money/ })).toHaveCount(0);

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('link', { name: /Money/ })).toBeVisible();
  });

  test('"Record a sale" after a harvest opens a linked income form', async ({ page }) => {
    await provisionEmptyFarm(page);
    await applePlanting(page);
    await page.goto('/harvest');
    await page.waitForLoadState('networkidle');
    const planting = page.locator('li.planting', { hasText: 'Orchard row' });
    await planting.getByRole('button', { name: 'Record harvest' }).click();
    await planting.locator('#fb-qty').fill('40 lb');
    await planting.getByRole('button', { name: 'Record harvest' }).last().click();

    const strip = page.getByTestId('record-sale');
    await expect(strip).toBeVisible();
    await strip.getByRole('link', { name: 'Record a sale' }).click();
    await expect(page).toHaveURL(/\/finance\/new\?kind=income&harvestEventId=/);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('A sale from this harvest.')).toBeVisible();
    await expect(page.getByLabel(/^Quantity/)).toHaveValue('40');
    await expect(page.getByLabel(/^Unit/)).toHaveValue('lb');
    await page.getByLabel('Amount in dollars').fill('80');
    await page.getByRole('button', { name: 'Save income' }).click();
    await expect(page).toHaveURL(/\/finance\?year=/);
    await page.waitForLoadState('networkidle');
    const sale = page.getByTestId('ledger-entry').filter({ hasText: 'Produce sale' });
    await expect(sale).toContainText('+$80.00');
    await expect(sale).toContainText('Crop:');
    await expect(sale).toContainText('40 lb');

    await page.goto('/harvest');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.stat-line')).toContainText(/1\s+events logged YTD/);
  });

  test('"Record purchase as expense" prefills from a lot and is only allowed once', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    const { item } = (await post(page, '/api/stock', {
      category: 'fertilizer',
      displayName: 'Composted manure',
      defaultUnit: 'lb'
    })) as { item: { id: string } };
    await post(page, `/api/stock/${item.id}/lots`, {
      receivedQuantity: 200,
      unit: 'lb',
      receivedCostCents: 4250
    });
    await page.goto(`/inventory/fertility/${item.id}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Record purchase as expense' }).click();
    await expect(page).toHaveURL(/\/finance\/new\?kind=expense&stockLotId=/);
    await page.waitForLoadState('networkidle');
    await expect(page.getByLabel('Amount in dollars')).toHaveValue('42.50');
    await expect(page.getByLabel('Category')).toHaveValue('fertility');
    await page.getByRole('button', { name: 'Save expense' }).click();
    await expect(page).toHaveURL(/\/finance\?year=/);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/of the expenses bought stock/)).toBeVisible();

    await page.goto(`/inventory/fertility/${item.id}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Record purchase as expense' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('This lot already has a purchase expense.')).toBeVisible();
  });
});
