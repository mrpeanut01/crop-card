import type { Locator, Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { openWizardFromPlan, provisionWizardTenant } from './lib/wizardTenant';
import { enableFixtureClaude } from './lib/fixtureClaude';

// #555: a cover crop sown by area goes through the planning wizard with the
// fixture Claude. It is planned in square feet from its sourced seeding
// rate, never as a count of plants, and the seed amount shows the source's
// range for the ground it gets.

const RYE = 'Cereal Rye — Aroostook';
const BEAN = 'Bush Bean — Provider';

function wizard(page: Page): Locator {
  return page.locator('.aw-modal');
}

function body(page: Page): Locator {
  return wizard(page).locator('.aw-body');
}

function footer(page: Page): Locator {
  return wizard(page).locator('.aw-footer');
}

async function expectActiveStep(page: Page, label: string): Promise<void> {
  await expect(
    wizard(page).locator('ol[aria-label="Wizard steps"] [aria-current="step"]')
  ).toHaveAttribute('aria-label', label);
}

type Selection = { stockItemId: string; quantityPlants?: number; areaSqFt?: number };
type Assignment = { stockItemId: string; plants: number; areaSqFt?: number };

test.describe('a cover crop through the wizard with the fixture Claude', () => {
  test.describe.configure({ timeout: 120_000 });

  test('is planned by area from its seeding rate, with no plant count', async ({ page }) => {
    const tenant = await provisionWizardTenant(page, {
      seasonSetup: true,
      seeds: [
        { displayName: RYE, pluginId: 'cereal-rye-cover', quantity: 1, unit: 'lb' },
        { displayName: BEAN, pluginId: 'bush-bean-provider', quantity: 200 }
      ]
    });
    const ryeId = tenant.seeds.find((s) => s.displayName === RYE)!.id;
    await enableFixtureClaude(page);
    await openWizardFromPlan(page);

    for (const btn of await body(page)
      .getByRole('button', { name: /^Select all .* seeds$/ })
      .all()) {
      if (await btn.isEnabled()) await btn.click();
    }

    // Seeds step: the ground the seed covers, Broadcast first (1 lb at the
    // top of 90-160 lb/acre is 272 sq ft), then Drilled (120 lb/acre).
    const cell = body(page).getByTestId('area-seed-cell');
    await expect(cell).toHaveCount(1);
    await expect(cell.getByTestId('sow-broadcast')).toHaveAttribute('aria-pressed', 'true');
    await expect(cell.getByTestId('area-covers')).toContainText('272 sq ft');
    await expect(cell).not.toContainText(/plants/i);
    await cell.getByTestId('sow-drilled').click();
    await expect(cell.getByTestId('sow-drilled')).toHaveAttribute('aria-pressed', 'true');
    await expect(cell.getByTestId('area-covers')).toContainText('363 sq ft');
    const toggle = await cell.getByTestId('sow-drilled').boundingBox();
    expect(toggle?.height ?? 0).toBeGreaterThanOrEqual(44);

    await footer(page)
      .getByRole('button', { name: /^Next: blocks/ })
      .click();
    await expectActiveStep(page, '2. Blocks');
    await body(page).getByRole('button', { name: 'Select all' }).click();
    const allocateReq = page.waitForRequest((r) => r.url().endsWith('/api/plan/allocate'));
    const allocateRes = page.waitForResponse((r) => r.url().endsWith('/api/plan/allocate'));
    await footer(page)
      .getByRole('button', { name: /^Generate plan \(2 blocks\)/ })
      .click();
    const sent = (await allocateReq).postDataJSON() as { seedSelections: Selection[] };
    const ryeSel = sent.seedSelections.find((s) => s.stockItemId === ryeId)!;
    expect(ryeSel.areaSqFt).toBe(363);
    expect(ryeSel.quantityPlants).toBeUndefined();

    const res = await allocateRes;
    expect(res.ok()).toBe(true);
    const allocated = (await res.json()) as {
      assignments: Assignment[];
      meta: { fallback?: string; provenance?: string };
    };
    expect(allocated.meta.fallback, 'the fixture plan should pass the validator').toBeUndefined();
    const ryeParts = allocated.assignments.filter((a) => a.stockItemId === ryeId);
    expect(ryeParts.length).toBeGreaterThan(0);
    for (const a of ryeParts) expect(a.areaSqFt).toBe(a.plants);
    expect(ryeParts.reduce((s, a) => s + (a.areaSqFt ?? 0), 0)).toBeLessThanOrEqual(363);

    await expectActiveStep(page, '3. Review');
    const row = body(page).locator('table.aw-table tbody tr').filter({ hasText: RYE }).first();
    await expect(row.getByTestId('review-area')).toContainText('sq ft');
    const amount = row.getByTestId('review-seed-amount');
    await expect(amount).toContainText(/^\s*Drilled: [\d.]+–[\d.]+ (oz|lb) for [\d,]+ sq ft/);
    await expect(amount.locator('[data-provenance="data"]')).toHaveCount(1);
    await expect(row).not.toContainText(/plants/i);

    // Commit: the rye planting is saved with no plant count.
    const plantingBodies: Array<Record<string, unknown>> = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/blocks\/[^/]+\/plantings$/.test(r.url())) {
        plantingBodies.push(r.postDataJSON() as Record<string, unknown>);
      }
    });
    await footer(page).getByRole('button', { name: 'Accept all → schedule' }).click();
    await expectActiveStep(page, '4. Schedule');
    await footer(page)
      .getByRole('button', { name: /^Accept dates → inputs plan/ })
      .click();
    await expectActiveStep(page, '5. Inputs');
    await body(page)
      .getByRole('button', { name: /Accept and commit/ })
      .click();
    await expect(wizard(page)).toHaveCount(0);
    const ryeRows = plantingBodies.filter((b) => b.cropPluginId === 'cereal-rye-cover');
    expect(ryeRows.length).toBeGreaterThan(0);
    for (const b of ryeRows) expect(b.plannedPlants).toBeUndefined();
    const beanRows = plantingBodies.filter((b) => b.cropPluginId === 'bush-bean-provider');
    expect(beanRows.some((b) => typeof b.plannedPlants === 'number')).toBe(true);
  });
});
