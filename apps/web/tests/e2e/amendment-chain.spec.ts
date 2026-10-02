import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 33C (cluster C2): the manure and compost carryover chain. A pile
// made from goats that grazed a GrazonNext HL pasture may carry a weed
// killer; a bought load the supplier knows nothing about is not known;
// bales from a hay cutting go into feed with the cutting linked.

const PHONE = { width: 375, height: 800 };

async function post<T>(page: Page, url: string, data: unknown, method = 'POST'): Promise<T> {
  const res = await page.request.fetch(url, {
    method,
    data,
    headers: { origin: originOf(page) }
  });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

const NOT_SAFE = /\bsafe\b|\bclear\b/i;

async function sprayedGoatPasture(page: Page) {
  const { field: pasture } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'North pasture',
    kind: 'pasture',
    acres: 2
  });
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Paddock 1',
    acres: 2,
    fieldId: pasture.id
  });
  const { group } = await post<{ group: { id: string } }>(page, '/api/animal-groups', {
    name: 'Goats',
    speciesId: 'goat',
    headCount: 4,
    housingFieldId: pasture.id
  });
  const { equipment } = await post<{ equipment: { id: string } }>(page, '/api/equipment', {
    type: 'sprayer',
    label: 'Backpack sprayer'
  });
  await post(page, '/api/spray/record', {
    blockId: block.id,
    blockCrops: { primary: { cropPluginId: 'orchard-grass-potomac' } },
    productPluginIds: ['grazonnext-hl'],
    sprayer: { id: equipment.id },
    conditions: { windMph: 4, tempF: 70, rainForecastMmNext24h: 0 }
  });
  return { pastureId: pasture.id, blockId: block.id, groupId: group.id };
}

test.describe('manure and compost carryover chain', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a helper builds a pile from goats that grazed a GrazonNext pasture: may carry', async ({
    page,
    browser
  }) => {
    await provisionEmptyFarm(page);
    await sprayedGoatPasture(page);

    const helper = await provisionHelper(page, browser);
    await helper.setViewportSize(PHONE);
    await open(helper, '/inventory');
    await expect(helper.getByRole('tab', { name: /Manure & compost/ })).toHaveCount(0);
    await helper.getByRole('link', { name: /Manure or compost pile/ }).click();
    await helper.waitForURL(/\/inventory\/amendment\/add$/);
    await helper.waitForLoadState('networkidle');
    await noHorizontalOverflow(helper);

    await helper.getByLabel('Name').fill('Goat pile');
    await helper.getByRole('button', { name: 'Save batch' }).click();
    await helper.waitForURL(/\/inventory\/amendment\/[^/]+$/);
    await helper.waitForLoadState('networkidle');
    await expect(helper.getByTestId('carryover-label')).toHaveText(
      "No carryover weed killer on file for this batch's sources."
    );
    await expect(helper.getByText('No sources added yet.')).toBeVisible();

    await helper.getByTestId('add-input-choice').selectOption({ label: 'Goats' });
    await helper.getByRole('button', { name: 'Add to this batch' }).click();
    await expect(helper.getByTestId('carryover-label')).toHaveText('May carry a weed killer');
    await expect(helper.getByTestId('carryover-paths')).toContainText(
      'Goats grazed North pasture from'
    );
    await expect(helper.getByTestId('carryover-paths')).toContainText('GrazonNext HL');
    await expect(helper.getByText(/Bought hay and feed are not traced/)).toBeVisible();
    await expect(helper.getByRole('button', { name: /Remove Goats/ })).toHaveCount(0);
    expect(await helper.locator('main').innerText()).not.toMatch(NOT_SAFE);
    await noHorizontalOverflow(helper);

    await open(helper, '/inventory?type=amendment');
    await expect(helper.getByRole('tab', { name: /Manure & compost/ })).toBeVisible();
    await expect(helper.getByTestId('amendment-list')).toContainText('Goat pile');
    await expect(helper.getByTestId('carryover-state')).toHaveText('May carry a weed killer');
    await noHorizontalOverflow(helper);

    await open(page, '/inventory?type=amendment');
    await page.getByRole('link', { name: /Goat pile/ }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /Remove Goats/ })).toBeVisible();
  });

  test('bought horse manure the supplier knows nothing about is not known, never safe', async ({
    page
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    await open(page, '/inventory/amendment/add');
    await page.getByLabel('Bought or brought in').check();
    await page.getByLabel('Name').fill('Horse manure');
    await page.getByRole('textbox', { name: 'Supplier' }).fill('Neighbour down the road');
    await page.getByTestId('supplier-statement').selectOption('unknown');
    await noHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Save batch' }).click();
    await page.waitForURL(/\/inventory\/amendment\/[^/]+$/);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('carryover-label')).toHaveText('Not known');
    await expect(page.getByTestId('carryover-advice')).toHaveText(
      'Ask the supplier which weed killers were used on the hay or pasture, or run a pea or bean test.'
    );
    await expect(page.getByTestId('add-input-form')).toHaveCount(0);
    expect(await page.locator('main').innerText()).not.toMatch(NOT_SAFE);

    await page.getByTestId('supplier-statement').selectOption('says-none');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByTestId('carryover-label')).toHaveText(
      "No carryover weed killer on file for this batch's sources."
    );
    await expect(page.getByText('The supplier said none was used.')).toBeVisible();
    expect(await page.locator('main').innerText()).not.toMatch(NOT_SAFE);
    await noHorizontalOverflow(page);
  });

  test('bales from a stored hay cutting go into feed with the cutting linked', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
      name: 'Hay field',
      kind: 'pasture',
      acres: 3
    });
    const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: 'Back hay',
      acres: 3,
      fieldId: field.id
    });
    const { cutting } = await post<{ cutting: { id: string } }>(page, '/api/hay/cuttings', {
      blockId: block.id,
      cropPluginId: 'timothy-climax',
      mowAt: Date.now() - 6 * 86_400_000
    });
    let status = 'mowing';
    for (let i = 0; i < 6 && status !== 'storing' && status !== 'complete'; i++) {
      const res = await post<{ cutting: { status: string } }>(
        page,
        `/api/hay/cuttings/${cutting.id}`,
        {
          action: 'advance',
          baleType: 'small-square',
          balesQuantity: 120,
          baleMoisturePct: 14
        },
        'PATCH'
      );
      status = res.cutting.status;
    }
    expect(['storing', 'complete']).toContain(status);

    await open(page, `/hay?block=${block.id}`);
    await page.getByTestId('bales-to-feed').first().click();
    await page.waitForURL(/\/inventory\/feed\/add\?hayCuttingId=/);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('hay-source')).toContainText('Back hay cutting 1');
    await noHorizontalOverflow(page);
    await page.getByLabel(/How much do you have/).fill('2400');
    await page.getByRole('button', { name: /Create feed or bedding/ }).click();
    await page.waitForURL(/\/inventory\?type=feed$/);

    const items = (await (await page.request.get('/api/stock')).json()) as {
      items: { id: string; displayName: string }[];
    };
    const hay = items.items.find((i) => i.displayName.startsWith('Hay, Back hay cutting 1'));
    expect(hay).toBeTruthy();

    const pile = await post<{ batch: { id: string } }>(page, '/api/amendments/batches', {
      kind: 'bedding-pack',
      name: 'Barn bedding',
      origin: 'on-farm',
      startedOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
        new Date(Date.now() - 86_400_000)
      )
    });
    await open(page, `/inventory/amendment/${pile.batch.id}`);
    await page.getByTestId('add-input-kind').selectOption('stock-lot');
    await page.getByTestId('add-input-choice').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Add to this batch' }).click();
    await expect(page.getByTestId('batch-inputs')).toContainText('Hay, Back hay cutting 1');
    await expect(page.getByTestId('carryover-label')).toHaveText(
      "No carryover weed killer on file for this batch's sources."
    );
  });
});
