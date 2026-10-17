import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

const DAY = 86_400_000;
// The e2e preview server runs with ENABLE_DEV_ROUTES=1, so a planting named
// with this marker reads as a tender perennial (37D test hook in
// lib/server/herbCalendar.server.ts) until 37B's sourced hardiness data
// gives a real herb that verdict.
const MARKER = 'e2e-tender-perennial';

async function post<T>(page: Page, url: string, data: Record<string, unknown>): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

test.describe('herb calendar (37D)', () => {
  test('a tender perennial herb gets a sourced bring-indoors bar', async ({ page }) => {
    await signInNewUser(page, 'herbcal');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const area = await post<{ field: { id: string } }>(page, '/api/fields', {
      name: 'Herb garden',
      kind: 'garden',
      widthFt: 10,
      lengthFt: 10
    });
    const bed = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: 'Herb bed',
      kind: 'bed',
      widthFt: 4,
      lengthFt: 8,
      fieldId: area.field.id
    });
    const tender = await post<{ planting: { id: string } }>(
      page,
      `/api/blocks/${bed.block.id}/plantings`,
      {
        cropPluginId: 'rosemary-tuscan-blue',
        varietyDisplayName: `Rosemary ${MARKER}`,
        plantingDate: Date.now() - 5 * DAY
      }
    );
    const plain = await post<{ planting: { id: string } }>(
      page,
      `/api/blocks/${bed.block.id}/plantings`,
      { cropPluginId: 'thyme-german-winter', plantingDate: Date.now() - 5 * DAY }
    );

    await page.goto('/plan/calendar');
    await page.waitForLoadState('networkidle');
    const cal = page.getByTestId('sowing-calendar');
    const row = cal.locator(`tr[data-planting-id="${tender.planting.id}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator('.bar[data-kind="bring-indoors"]')).toHaveCount(1);
    await expect(row.getByTestId('row-dates')).toContainText('Bring indoors');
    await expect(row.getByTestId('row-bring-source')).toContainText(
      'Bring in 2 to 3 weeks before the first fall frost (UW-Madison Extension).'
    );
    await expect(row.getByTestId('row-bring-source')).toContainText('UW-Madison Extension');
    await expect(row.getByTestId('row-typical')).toHaveCount(0);
    await expect(cal.locator('.legend')).toContainText('Bring indoors before frost');

    const other = cal.locator(`tr[data-planting-id="${plain.planting.id}"]`);
    await expect(other).toBeVisible();
    await expect(other.locator('.bar[data-kind="bring-indoors"]')).toHaveCount(0);
  });
});
