import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// #736: the insecticide and fungicide pages pick a sprayer, so the server's
// cross-contamination gate always runs. #643: the insecticide page opens on
// its heading, with the product library folded below the form.

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function auxinLoadedSprayer(page: Page) {
  await provisionEmptyFarm(page);
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Wheat A',
    acres: 2
  });
  const { equipment: sprayer } = await post<{ equipment: { id: string } }>(page, '/api/equipment', {
    type: 'sprayer',
    label: 'Boom 200'
  });
  await post(page, '/api/spray/record', {
    blockId: block.id,
    blockCrops: { primary: { cropPluginId: '__pre-plant__' } },
    productPluginIds: ['2-4-d-amine'],
    sprayer: { id: sprayer.id },
    conditions: { windMph: 4, tempF: 70, rainForecastMmNext24h: 0 }
  });
  return { blockId: block.id, sprayerId: sprayer.id };
}

test.describe('spray pages pick a sprayer (#736)', () => {
  test('an insecticide or fungicide record without a sprayer is refused', async ({ page }) => {
    const { blockId } = await auxinLoadedSprayer(page);
    for (const [url, product] of [
      ['/api/insecticide/record', 'surround-wp'],
      ['/api/fungicide/record', 'champ-dp']
    ]) {
      const res = await page.request.post(url, {
        data: {
          blockId,
          productPluginIds: [product],
          conditions: { windMph: 4, tempF: 70, rainForecastMmNext24h: 0 }
        },
        headers: { origin: originOf(page) }
      });
      expect(res.status(), url).toBe(400);
    }
  });

  test('fungicide: the auxin-loaded sprayer is stopped and sent to decon', async ({ page }) => {
    const { blockId, sprayerId } = await auxinLoadedSprayer(page);
    await page.goto(`/spray/fungicide?block=${blockId}&product=champ-dp`);
    await page.waitForLoadState('networkidle');
    const section = page.getByTestId('sprayer-section');
    const pick = section.locator(`[data-sprayer-id="${sprayerId}"]`);
    await expect(pick).toHaveAttribute('aria-pressed', 'true');
    await expect(pick).toContainText('synthetic-auxin');
    await page.getByRole('button', { name: 'Record fungicide application' }).click();
    await expect(page.getByRole('link', { name: 'Open decon wizard →' })).toHaveAttribute(
      'href',
      `/spray/decon?sprayer=${sprayerId}`
    );
  });

  test('insecticide: the heading comes before the folded library', async ({ page }) => {
    await auxinLoadedSprayer(page);
    await page.goto('/spray/insecticide');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveTitle(/Insecticides · CropCard/);
    const heading = page.getByRole('heading', { level: 1, name: 'Insecticides' });
    const library = page.getByTestId('insecticide-library');
    await expect(library).not.toHaveAttribute('open', '');
    const headingY = (await heading.boundingBox())?.y ?? Infinity;
    const libraryY = (await library.boundingBox())?.y ?? -Infinity;
    expect(headingY).toBeLessThan(libraryY);
    await expect(page.getByTestId('sprayer-section')).toBeVisible();
  });
});
