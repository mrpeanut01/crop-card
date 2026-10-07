import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 32C (cluster C2): the Area Card's grazing line and the advisory
// pasture notice on the spray context strip. No product carries sourced
// grazing data yet, so a sprayed pasture reads as "not on file".

const PHONE = { width: 375, height: 800 };

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

async function seedPasture(page: Page) {
  await provisionEmptyFarm(page);
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'North pasture',
    kind: 'pasture',
    acres: 2
  });
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Paddock 1',
    acres: 2,
    fieldId: field.id
  });
  await post(page, '/api/animal-groups', {
    name: 'Ewes',
    speciesId: 'sheep',
    headCount: 12,
    housingFieldId: field.id
  });
  return { fieldId: field.id, blockId: block.id };
}

test.describe('grazing advisories', () => {
  test.describe.configure({ timeout: 120_000 });

  test('the spray strip names the animals on the pasture and never blocks the spray', async ({
    page
  }) => {
    await page.setViewportSize(PHONE);
    const farm = await seedPasture(page);
    await page.goto(`/spray/fungicide?block=${farm.blockId}&product=champ-dp`);
    await page.waitForLoadState('networkidle');
    const note = page.getByRole('note', { name: 'Animals on this Area' });
    await expect(note).toContainText('Animals here now in North pasture: 12 sheep (Ewes).');
    await expect(note).toContainText('is not on file');
    await expect(note).toContainText('Move them off before you spray.');
    await noHorizontalOverflow(page);
  });

  test('a sprayed pasture shows its grazing hold on the Area Card', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const farm = await seedPasture(page);
    const { equipment: sprayer } = await post<{ equipment: { id: string } }>(
      page,
      '/api/equipment',
      { type: 'sprayer', label: 'Backpack sprayer' }
    );
    await post(page, '/api/fungicide/record', {
      sprayerId: sprayer.id,
      blockId: farm.blockId,
      productPluginIds: ['champ-dp'],
      conditions: { windMph: 4, tempF: 70, rainForecastMmNext24h: 0 }
    });
    await page.goto(`/plan?setup=skip&field=${farm.fieldId}`);
    await page.waitForLoadState('networkidle');
    const area = page
      .getByTestId('plan-area-view')
      .locator('article[data-card-kind="area"][data-variant="screen"]');
    await expect(area).toContainText('Grazing on hold for food animals');
    await expect(area).toContainText('Hay cutting on hold');
    await noHorizontalOverflow(page);

    const moved = await page.request.patch(`/api/blocks/${farm.blockId}`, {
      data: {
        fieldId: (
          await post<{ field: { id: string } }>(page, '/api/fields', {
            name: 'Back lot',
            kind: 'field'
          })
        ).field.id
      },
      headers: { origin: originOf(page) }
    });
    expect(moved.status()).toBe(409);
    expect((await moved.json()).error).toBe('BLOCK_HAS_GRAZING_HOLD');
  });
});
