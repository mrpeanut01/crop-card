import type { Locator, Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { openWizardFromPlan, provisionWizardTenant } from './lib/wizardTenant';

// Phase 35 (R-33): one counted seed lot bigger than one of two picked garden
// beds is split into one planting per bed, committed with one split group
// id, shown on /plan as "One seed lot in 2 beds", and the seed on hand drops
// by exactly the lot. Every step runs the no-key deterministic path.

const BEAN = 'Bush Bean — Provider';
const SEEDS = 100;

function wizard(page: Page): Locator {
  return page.locator('.aw-modal');
}
function body(page: Page): Locator {
  return wizard(page).locator('.aw-body');
}
function footer(page: Page): Locator {
  return wizard(page).locator('.aw-footer');
}
function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}
async function post<T>(page: Page, url: string, data: Record<string, unknown>): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: origin(page) } });
  if (!res.ok()) throw new Error(`${url} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

type AllocateJson = {
  assignments: Array<{ stockItemId: string; blockId: string; plants: number }>;
  unplaced: Array<{ stockItemId: string; quantityPlants: number }>;
  leftover?: Array<{ stockItemId: string; blocks: Array<{ blockId: string; status: string }> }>;
};

/** A garden Area with two 4 by 8 ft beds and one counted bean lot. Bush
 *  bean spacing gives about 64 plants a bed, so the lot needs both. */
async function setup(page: Page) {
  const tenant = await provisionWizardTenant(page, {
    seasonSetup: true,
    blocks: [],
    seeds: [{ displayName: BEAN, pluginId: 'bush-bean-provider', quantity: SEEDS }]
  });
  const { field: garden } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Kitchen garden',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  const beds: Array<{ id: string; name: string }> = [];
  for (const name of ['Bed A', 'Bed B']) {
    const { block } = await post<{ block: { id: string; name: string } }>(page, '/api/blocks', {
      name,
      kind: 'bed',
      widthFt: 4,
      lengthFt: 8,
      fieldId: garden.id
    });
    beds.push(block);
  }
  return { gardenId: garden.id, beds, stockItemId: tenant.seeds[0].id };
}

async function generate(page: Page): Promise<AllocateJson> {
  await openWizardFromPlan(page);
  await body(page)
    .getByRole('checkbox', { name: `Select ${BEAN}` })
    .check();
  await footer(page)
    .getByRole('button', { name: /^Next: blocks/ })
    .click();
  await body(page).getByRole('button', { name: 'Select all' }).click();
  const allocate = page.waitForResponse((r) => r.url().endsWith('/api/plan/allocate'));
  await footer(page)
    .getByRole('button', { name: /^Generate plan/ })
    .click();
  return (await (await allocate).json()) as AllocateJson;
}

async function onHand(page: Page, stockItemId: string): Promise<number> {
  const json = (await page.evaluate(async (id) => {
    const res = await fetch(`/api/stock/${id}`);
    return res.json();
  }, stockItemId)) as { lots: Array<{ balance: number; quantityStatus?: string }> };
  return json.lots
    .filter((l) => (l.quantityStatus ?? 'existing') === 'existing')
    .reduce((s, l) => s + l.balance, 0);
}

test.describe('one seed lot across several beds', () => {
  test.describe.configure({ timeout: 150_000 });

  test('a lot bigger than one bed splits, commits as one group and shows on /plan', async ({
    page
  }) => {
    const { gardenId, beds, stockItemId } = await setup(page);
    const plan = await generate(page);
    expect(await onHand(page, stockItemId)).toBe(SEEDS);
    const parts = plan.assignments.filter((a) => a.stockItemId === stockItemId);
    expect(new Set(parts.map((a) => a.blockId)).size).toBe(2);

    const rows = body(page).locator('table.aw-table tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByTestId('split-chip')).toHaveText('Split across 2 beds');
    await expect(rows.nth(1).getByTestId('split-chip')).toHaveText('Split across 2 beds');
    const keep = body(page).getByTestId('keep-in-one-bed');
    await expect(keep).toHaveCount(1);
    await expect(keep).toHaveAttribute('aria-pressed', 'false');
    const box = await keep.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);

    await footer(page).getByRole('button', { name: 'Accept all → schedule' }).click();
    await footer(page)
      .getByRole('button', { name: /^Accept dates → inputs plan/ })
      .click();
    const posts: Array<{ body: Record<string, unknown>; key: string | null }> = [];
    page.on('request', (r) => {
      if (/\/api\/blocks\/[^/]+\/plantings$/.test(r.url()) && r.method() === 'POST') {
        posts.push({
          body: JSON.parse(r.postData() ?? '{}') as Record<string, unknown>,
          key: r.headers()['x-cropcard-client-record-id'] ?? null
        });
      }
    });
    const inputsCommit = page.waitForResponse((r) => r.url().endsWith('/api/plan/inputs/commit'));
    await body(page)
      .getByRole('button', { name: /Accept and commit/ })
      .click();
    await inputsCommit.catch(() => undefined);
    await expect(wizard(page)).toHaveCount(0);

    expect(posts.length).toBeGreaterThanOrEqual(2);
    const groups = new Set(posts.map((p) => p.body.splitGroupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toMatch(/^sg_[A-Za-z0-9-]{8,64}$/);
    expect(new Set(posts.map((p) => p.key)).size).toBe(posts.length);
    const drawn = posts.reduce((s, p) => s + Number(p.body.quantityPlanted ?? 0), 0);
    expect(drawn).toBe(SEEDS);
    expect(await onHand(page, stockItemId)).toBe(0);

    await page.goto(`/plan?field=${gardenId}&block=${beds[0].id}`);
    await page.waitForLoadState('networkidle');
    const split = page.getByTestId('planting-split').first();
    await expect(split).toContainText('One seed lot in 2 beds');
    await expect(split.getByRole('link', { name: 'Bed B' })).toBeVisible();
    await expect(split).toContainText('Plantings already saved stay where they are.');
    const toggle = split.getByTestId('plan-keep-in-one-bed');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const save = page.waitForResponse((r) => r.url().endsWith('/api/plan/keep-in-one-bed'));
    await toggle.click();
    expect((await save).ok()).toBe(true);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByTestId('planting-split').first().getByTestId('plan-keep-in-one-bed')
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('planting-split')).toHaveCount(1);
  });

  test('Keep in one bed plans the lot again on one bed and says why the rest is left', async ({
    page
  }) => {
    const { stockItemId } = await setup(page);
    const first = await generate(page);
    expect(first).toHaveProperty('leftover');
    await expect(body(page).getByTestId('keep-note')).toBeVisible();
    const replan = page.waitForResponse((r) => r.url().endsWith('/api/plan/allocate'));
    await body(page).getByTestId('keep-in-one-bed').click();
    const kept = (await (await replan).json()) as AllocateJson;
    const parts = kept.assignments.filter((a) => a.stockItemId === stockItemId);
    expect(new Set(parts.map((a) => a.blockId)).size).toBe(1);
    await expect(body(page).getByTestId('split-chip')).toHaveCount(0);
    await expect(body(page).getByTestId('unplaced-row')).toContainText(
      "didn't fit in the blocks you picked"
    );
    await expect(body(page).getByTestId('leftover-reasons')).toContainText(
      'was not used: kept in one bed'
    );
    await expect(body(page).getByTestId('keep-in-one-bed')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the Review step has no sideways scroll at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await setup(page);
    await generate(page);
    await expect(body(page).getByTestId('split-chip').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // The wizard is a fixed modal with its own scroll box, so the page width
    // never shows overflow inside it. Measure the modal body itself.
    const inner = await body(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(inner).toBeLessThanOrEqual(0);
    const box = await body(page).boundingBox();
    for (const id of ['split-chip', 'keep-in-one-bed']) {
      const b = await body(page).getByTestId(id).first().boundingBox();
      expect(b && box).toBeTruthy();
      expect(b!.x).toBeGreaterThanOrEqual(box!.x - 0.5);
      expect(b!.x + b!.width).toBeLessThanOrEqual(box!.x + box!.width + 0.5);
    }
  });
});
