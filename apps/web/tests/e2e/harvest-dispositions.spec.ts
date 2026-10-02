import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 33B (B2): where a harvest went, the "Also record the money" link
// and the offline replay of a helper's disposition.

async function post(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return res.json();
}

async function appleHarvest(page: Page): Promise<{ harvestId: string }> {
  const { block } = (await post(page, '/api/blocks', { name: 'Orchard row' })) as {
    block: { id: string };
  };
  await post(page, `/api/blocks/${block.id}/plantings`, {
    cropPluginId: 'apple-orchard',
    plantingDate: Date.now() - 400 * 86_400_000
  });
  const { event } = (await post(page, '/api/harvest/record', {
    blockId: block.id,
    cropPluginId: 'apple-orchard',
    quantity: '40 lb'
  })) as { event: { id: string } };
  return { harvestId: event.id };
}

async function dispositions(page: Page, harvestId: string): Promise<Array<{ kind: string }>> {
  const res = await page.request.get(`/api/harvest/${harvestId}/dispositions`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { dispositions: Array<{ kind: string }> }).dispositions;
}

test.describe('harvest dispositions (33B)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('an owner records a sale after a harvest and links the money', async ({ page }) => {
    await provisionEmptyFarm(page);
    const { block } = (await post(page, '/api/blocks', { name: 'Orchard row' })) as {
      block: { id: string };
    };
    await post(page, `/api/blocks/${block.id}/plantings`, {
      cropPluginId: 'apple-orchard',
      plantingDate: Date.now() - 400 * 86_400_000
    });
    await page.goto('/harvest');
    await page.waitForLoadState('networkidle');
    const planting = page.locator('li.planting', { hasText: 'Orchard row' });
    await planting.getByRole('button', { name: 'Record harvest' }).click();
    await planting.locator('#fb-qty').fill('40 lb');
    await planting.getByRole('button', { name: 'Record harvest' }).last().click();

    await page.getByTestId('where-did-it-go').click();
    const sheet = page.getByRole('dialog', { name: 'Where did it go?' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Nothing recorded yet')).toBeVisible();
    await expect(sheet.getByText('Sold as organic?')).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Sold', exact: true }).click();
    await sheet.getByLabel('How much').fill('10');
    await sheet.getByLabel('Unit').fill('lb');
    await sheet.getByLabel(/Sold to/).fill('Farm stand');
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    const row = sheet.getByTestId('disposition-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Sold 10 lb to Farm stand on');

    await sheet.getByRole('button', { name: 'Thrown out' }).click();
    await sheet.getByLabel('How much').fill('35');
    await sheet.getByLabel('Unit').fill('lb');
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet.getByRole('status')).toContainText(
      "Where it went adds up to more than this harvest's 40 lb."
    );
    await expect(row).toHaveCount(2);

    await sheet.getByRole('link', { name: 'Also record the money' }).click();
    await expect(page).toHaveURL(/\/finance\/new\?.*dispositionId=/);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/The sale of 10 lb from this harvest/)).toBeVisible();
    await expect(page.getByLabel(/^Quantity/)).toHaveValue('10');
    await page.getByLabel('Amount in dollars').fill('25');
    await page.getByRole('button', { name: 'Save income' }).click();
    await expect(page).toHaveURL(/\/finance\?year=/);

    await page.goto('/harvest');
    await page.waitForLoadState('networkidle');
    const open = page.locator('[data-testid^="where-it-went-"]').first();
    await expect(open).toHaveText('2 recorded');
    await open.click();
    const again = page.getByRole('dialog', { name: 'Where did it go?' });
    await expect(again.getByText('Sale recorded')).toBeVisible();
    await expect(again.getByRole('link', { name: 'Also record the money' })).toHaveCount(0);
  });

  test('a helper records where it went offline and it replays once', async ({ page, browser }) => {
    await provisionEmptyFarm(page);
    const { harvestId } = await appleHarvest(page);
    const helper = await provisionHelper(page, browser);
    await helper.goto('/harvest');
    await helper.waitForLoadState('networkidle');

    await helper.getByTestId(`where-it-went-${harvestId}`).click();
    const sheet = helper.getByRole('dialog', { name: 'Where did it go?' });
    await expect(sheet.getByText('Nothing recorded yet')).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Also record the money' })).toHaveCount(0);
    await helper.context().setOffline(true);
    await sheet.getByRole('button', { name: 'Given away' }).click();
    await sheet.getByLabel('How much').fill('3');
    await sheet.getByLabel('Unit').fill('dozen');
    await sheet.getByLabel(/Given to/).fill('Food bank');
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet.getByRole('status')).toContainText('Saved on this phone');

    await helper.context().setOffline(false);
    await expect
      .poll(async () => (await dispositions(page, harvestId)).length, {
        timeout: 20_000
      })
      .toBe(1);
    await helper.waitForTimeout(1_500);
    const list = await dispositions(page, harvestId);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe('donated');

    await helper.reload();
    await helper.waitForLoadState('networkidle');
    await expect(helper.getByTestId(`where-it-went-${harvestId}`)).toHaveText('1 recorded');
    await helper.close();
  });

  test('the sheet fits a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await provisionEmptyFarm(page);
    const { harvestId } = await appleHarvest(page);
    await post(page, `/api/harvest/${harvestId}/dispositions`, {
      kind: 'sold',
      quantity: 12.5,
      unit: 'lb',
      recipient: 'A very long name for the farmers market down the road'
    });
    await page.goto('/harvest');
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375
    );
    const where = page.getByTestId(`where-it-went-${harvestId}`);
    const whereBox = await where.boundingBox();
    expect(whereBox!.x).toBeGreaterThanOrEqual(0);
    expect(whereBox!.x + whereBox!.width).toBeLessThanOrEqual(375);
    expect(whereBox!.height).toBeGreaterThanOrEqual(48);
    await where.click();
    const sheet = page.getByRole('dialog', { name: 'Where did it go?' });
    await expect(sheet.getByTestId('disposition-row')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375
    );
    const save = sheet.getByRole('button', { name: 'Save', exact: true });
    const box = await save.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
  });
});
