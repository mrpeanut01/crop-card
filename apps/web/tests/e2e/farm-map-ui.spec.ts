import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// #636 #752 #635: the Dimensions list on /plan/farm warns in words when
// blocks outgrow their Area or reuse a name, a long unbroken block name
// wraps instead of pushing the page sideways, and the Continue bar sits
// below the map on a phone instead of floating over it.

test.use({ viewport: { width: 375, height: 800 } });

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

test('blocks bigger than their Area and reused names get a written warning', async ({ page }) => {
  await provisionEmptyFarm(page);
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'North Field',
    kind: 'field',
    widthFt: 660,
    lengthFt: 660
  });
  for (const name of ['North A', 'North A', 'North B']) {
    await post(page, '/api/blocks', { name, fieldId: field.id, widthFt: 330, lengthFt: 660 });
  }
  await post(page, '/api/blocks', {
    name: 'Apples(Gala/Honeycrisp/GoldRush/Fuji/Pink-Lady)',
    fieldId: field.id,
    widthFt: 10,
    lengthFt: 10
  });

  await page.goto('/plan/farm?mode=sketch');
  await page.waitForLoadState('networkidle');

  await expect(page.getByTestId('area-blocks-over')).toContainText('North Field');
  await expect(page.getByTestId('area-blocks-duplicate')).toContainText('North A');
  await expect(page.getByTestId('sketch-overflow')).toContainText('North Field');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const position = await page
    .locator('.continue-bar')
    .evaluate((el) => getComputedStyle(el).position);
  expect(position).toBe('static');
});
