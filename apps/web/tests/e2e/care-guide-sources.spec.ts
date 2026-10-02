import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';

/**
 * Phase 33D D5: the Care Guide shows only general tips that carry a quoted
 * extension source, leaves a section out when no sourced tip is left, and
 * never shows the removed, unsourced lines.
 */

function originOf(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: { origin: originOf(page) }
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as T;
}

async function plantInBed(page: Page, cropPluginId: string): Promise<string> {
  const area = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Kitchen Garden',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  const bed = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Bed 1',
    fieldId: area.field.id,
    kind: 'bed',
    bedStyle: 'raised',
    widthFt: 4,
    lengthFt: 8,
    xFt: 2,
    yFt: 3,
    rotationDeg: 0
  });
  const placed = await post<{ planting: { id: string } }>(
    page,
    `/api/blocks/${bed.block.id}/plantings`,
    {
      cropPluginId,
      footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 48 },
      spacingPattern: 'square'
    }
  );
  return placed.planting.id;
}

async function careGuideFor(page: Page, plantingId: string) {
  await page.goto(`/cards/planting/pl_${plantingId}`);
  await page.waitForLoadState('networkidle');
  const guide = page.getByTestId('care-guides').locator('[data-card-kind="careGuide"]').first();
  await expect(guide).toBeVisible();
  return guide;
}

test.describe('Care Guide sourced tips', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('a tomato shows the sourced tips and none of the removed ones', async ({ page }) => {
    await provisionEmptyFarm(page);
    const plantingId = await plantInBed(page, 'tomato-amish-paste');
    const guide = await careGuideFor(page, plantingId);

    await expect(guide).toContainText(
      'Aim for about an inch of water a week, from rain or watering.'
    );
    await expect(guide).toContainText('Put in stakes or cages at planting time.');
    await expect(guide).toContainText('Hornworms are easily removed by hand.');
    await expect(guide).toContainText('General tips for tomatoes, peppers and eggplant');
    await expect(guide).not.toContainText('Remove leaves touching the soil.');
    await expect(guide).not.toContainText('Side-dress with compost when the first fruit sets.');
    await expect(guide).not.toContainText('pinch the small shoots');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a bean leaves out the sections with no sourced tip', async ({ page }) => {
    await provisionEmptyFarm(page);
    const plantingId = await plantInBed(page, 'bush-bean-blue-lake-274');
    const guide = await careGuideFor(page, plantingId);

    await expect(guide).toContainText('Rhizobium');
    await expect(guide).not.toContainText('Water deeply when flowering');
    await expect(guide).not.toContainText('Skip extra feeding');
    await expect(guide.getByRole('heading', { name: /^Feed\b/ })).toHaveCount(1);
    await expect(guide.getByRole('heading', { name: /^Water\b/ })).toHaveCount(0);
    await expect(guide.getByRole('heading', { name: /^Common problems\b/ })).toHaveCount(0);
  });
});
