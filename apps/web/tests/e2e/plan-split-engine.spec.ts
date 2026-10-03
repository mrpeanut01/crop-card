import type { Locator, Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { openWizardFromPlan, provisionWizardTenant } from './lib/wizardTenant';

// Phase 35 split engine (no-key path): one counted seed lot spreads over the
// picked blocks before anything is left over, a keep-in-one-bed lot stays
// on one block, and every allocate answer carries the leftover report.

const BEAN = 'Bush Bean — Provider';

type Leftover = {
  stockItemId: string;
  cropPluginId: string;
  plantsLeft: number;
  blocks: Array<{ blockId: string; status: string; withPluginId?: string }>;
};
type AllocateBody = {
  assignments: Array<{ stockItemId: string; blockId: string; plants: number }>;
  unplaced: Array<{ stockItemId: string; quantityPlants: number }>;
  leftover: Leftover[];
  sharedBedBlockIds: string[];
  meta: { fallback?: string };
};

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function allocate(
  page: Page,
  seed: { id: string; quantityPlants: number; keepInOneBed?: boolean },
  blockIds: string[]
): Promise<AllocateBody> {
  const res = await page.request.post('/api/plan/allocate', {
    data: {
      seedSelections: [
        {
          stockItemId: seed.id,
          cropPluginId: 'bush-bean-provider',
          varietyDisplayName: BEAN,
          quantityPlants: seed.quantityPlants,
          ...(seed.keepInOneBed ? { keepInOneBed: true } : {})
        }
      ],
      blockIds
    },
    headers: { origin: origin(page) }
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as AllocateBody;
}

function body(page: Page): Locator {
  return page.locator('.aw-modal .aw-body');
}
function footer(page: Page): Locator {
  return page.locator('.aw-modal .aw-footer');
}

test.describe('one seed lot across several blocks', () => {
  test.describe.configure({ timeout: 120_000 });

  test('the engine fills both picked blocks and reports what is left, block by block', async ({
    page
  }) => {
    const tenant = await provisionWizardTenant(page, {
      seasonSetup: true,
      blocks: [
        { name: 'Split North', acres: 0.003 },
        { name: 'Split South', acres: 0.003 }
      ],
      seeds: [{ displayName: BEAN, pluginId: 'bush-bean-provider', quantity: 5000 }]
    });
    const blockIds = tenant.blocks.map((b) => b.id);
    const seedId = tenant.seeds[0].id;

    const full = await allocate(page, { id: seedId, quantityPlants: 5000 }, blockIds);
    expect(full.meta.fallback).toBe('no-api-key');
    expect(new Set(full.assignments.map((a) => a.blockId))).toEqual(new Set(blockIds));
    const placed = full.assignments.reduce((s, a) => s + a.plants, 0);
    expect(full.leftover).toEqual([
      {
        stockItemId: seedId,
        cropPluginId: 'bush-bean-provider',
        plantsLeft: 5000 - placed,
        blocks: blockIds.map((blockId) => ({ blockId, status: 'full' }))
      }
    ]);
    expect(full.unplaced[0].quantityPlants).toBe(5000 - placed);
    expect(full.sharedBedBlockIds).toEqual([]);

    const perBlock = Math.max(...full.assignments.map((a) => a.plants));
    const qty = perBlock + 5;
    const split = await allocate(page, { id: seedId, quantityPlants: qty }, blockIds);
    expect(new Set(split.assignments.map((a) => a.blockId)).size).toBe(2);
    expect(split.assignments.reduce((s, a) => s + a.plants, 0)).toBe(qty);
    expect(split.leftover).toEqual([]);
    expect(split.unplaced).toEqual([]);

    const kept = await allocate(
      page,
      { id: seedId, quantityPlants: qty, keepInOneBed: true },
      blockIds
    );
    expect(new Set(kept.assignments.map((a) => a.blockId)).size).toBe(1);
    const home = kept.assignments[0].blockId;
    expect(kept.leftover).toHaveLength(1);
    expect(kept.leftover[0].plantsLeft).toBe(qty - kept.assignments[0].plants);
    expect(kept.leftover[0].blocks).toEqual(
      expect.arrayContaining([
        { blockId: home, status: 'full' },
        { blockId: blockIds.find((b) => b !== home)!, status: 'kept-in-one-bed' }
      ])
    );
  });

  test('the Review step lists one row per block for a split lot', async ({ page }) => {
    await provisionWizardTenant(page, {
      seasonSetup: true,
      blocks: [
        { name: 'Split North', acres: 0.003 },
        { name: 'Split South', acres: 0.003 }
      ],
      seeds: [{ displayName: BEAN, pluginId: 'bush-bean-provider', quantity: 5000 }]
    });
    await openWizardFromPlan(page);
    await body(page)
      .locator('tr', { has: page.getByRole('checkbox', { name: `Select ${BEAN}` }) })
      .getByRole('checkbox')
      .check();
    await footer(page)
      .getByRole('button', { name: /^Next: blocks/ })
      .click();
    await body(page).getByRole('button', { name: 'Select all' }).click();
    const res = page.waitForResponse((r) => r.url().endsWith('/api/plan/allocate'));
    await footer(page)
      .getByRole('button', { name: /^Generate plan/ })
      .click();
    const json = (await (await res).json()) as AllocateBody;
    expect(new Set(json.assignments.map((a) => a.blockId)).size).toBe(2);
    const rows = body(page).locator('table.aw-table tbody tr', { hasText: BEAN });
    await expect(rows).toHaveCount(2);
    await expect(body(page).locator('table.aw-table tbody')).toContainText('Split North');
    await expect(body(page).locator('table.aw-table tbody')).toContainText('Split South');
  });
});
