import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, signInNewUser } from './lib/newOwner';

/**
 * Phase 37B: a garden owner who typed their own zone sees, on each herb's
 * Planting card and planting page, whether it is an annual or a perennial
 * here, the zone it was judged with and whether the lifecycle is sourced.
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

async function herbBed(page: Page): Promise<string> {
  const area = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Herb garden',
    kind: 'garden',
    widthFt: 12,
    lengthFt: 12
  });
  const bed = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Herb bed',
    fieldId: area.field.id,
    kind: 'bed',
    bedStyle: 'raised',
    widthFt: 4,
    lengthFt: 8,
    xFt: 1,
    yFt: 1,
    rotationDeg: 0
  });
  return bed.block.id;
}

async function plant(page: Page, blockId: string, cropPluginId: string, xIn: number) {
  const placed = await post<{ planting: { id: string } }>(
    page,
    `/api/blocks/${blockId}/plantings`,
    {
      cropPluginId,
      footprint: { x_in: xIn, y_in: 0, w_in: 24, l_in: 24 },
      spacingPattern: 'square'
    }
  );
  return placed.planting.id;
}

async function plantingCard(page: Page, plantingId: string) {
  await page.goto(`/cards/planting/pl_${plantingId}`);
  await page.waitForLoadState('networkidle');
  const card = page.locator('[data-card-kind="planting"]').first();
  await expect(card).toBeVisible();
  return card;
}

test.describe('annual, biennial or perennial here', () => {
  test.describe.configure({ timeout: 90_000 });
  test.use({ viewport: { width: 375, height: 800 } });

  test('a typed zone gives the herb line on the Planting card and planting page', async ({
    page
  }) => {
    await signInNewUser(page, 'herblife');
    await createOnboardedFarm(page, { growing: ['garden'] });

    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('zone-input').fill('7b');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

    const blockId = await herbBed(page);
    const lemongrass = await plant(page, blockId, 'lemongrass-east-indian', 0);
    const rosemary = await plant(page, blockId, 'rosemary-tuscan-blue', 24);

    // #867: lemongrass's lifecycle is now sourced, but no page gives its zone.
    const noZone = await plantingCard(page, lemongrass);
    await expect(noZone).toContainText('Annual or perennial here');
    await expect(noZone).toContainText('Perennial; the coldest zone it survives is not known yet.');
    await expect(noZone).not.toContainText('Not yet checked against a source.');
    await expect(noZone).toContainText('Using the zone you entered, 7b.');

    const tender = await plantingCard(page, rosemary);
    await expect(tender).toContainText(
      'Comes back in zones 8a and warmer; here, bring it in or grow it as an annual.'
    );
    await expect(tender).toContainText('Using the zone you entered, 7b.');
    await expect(tender).not.toContainText('Not yet checked against a source.');

    await page.goto(`/crops/${rosemary}`);
    await page.waitForLoadState('networkidle');
    const line = page.getByTestId('lifecycle-line');
    await expect(line).toHaveAttribute('data-lifecycle', 'tender-perennial');
    await expect(line).toContainText('Tender perennial');
    await expect(line.locator('[data-provenance="manual"]')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
