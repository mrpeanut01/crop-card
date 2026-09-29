import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionHelper } from './lib/freshFarm';
import { provisionWizardTenant } from './lib/wizardTenant';

// Phase 32A: an owner copies a Virginia Tech report (lb per acre, with
// nitrate) into /fertility, sees it in the history, and the Inputs Plan's
// pre-plant fertilizer shrinks by the soil-test credits. A helper gets the
// "Ask the owner" note instead of the form.

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function preplantRate(page: Page, blockId: string, year: number): Promise<number> {
  const res = await page.request.post('/api/plan/inputs', {
    data: {
      year,
      plantings: [
        {
          id: 'e2e-soil-beet',
          blockId,
          cropPluginId: 'beet-detroit-dark-red',
          varietyDisplayName: 'Detroit Dark Red beet',
          plantingDate: new Date(year, 4, 1).getTime()
        }
      ]
    },
    headers: { origin: origin(page) }
  });
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as {
    plan: { applications: Array<{ slot: string; rateAmount: number | null }> };
  };
  const app = body.plan.applications.find((a) => a.slot === 'pre-plant-fertility');
  return app?.rateAmount ?? 0;
}

test.describe('soil tests on /fertility', () => {
  test.describe.configure({ timeout: 150_000 });

  test('an owner saves a lb/A report and the Inputs Plan credits it', async ({ page }) => {
    const farm = await provisionWizardTenant(page, {
      seasonSetup: true,
      seeds: [],
      blocks: [{ name: 'North Field', acres: 1 }]
    });
    const blockId = farm.blocks[0].id;
    const before = await preplantRate(page, blockId, farm.year);
    expect(before).toBeGreaterThan(0);

    await page.goto(`/fertility?block=${blockId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Fertility', level: 1 })).toBeVisible();
    const form = page.getByTestId('setup-soil-test');
    // A click before the page hydrates does nothing, so retry until it opens.
    await expect(async () => {
      await page.getByRole('button', { name: 'Add a soil test' }).click({ timeout: 2000 });
      await expect(form).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(form).toBeVisible();
    await form.getByLabel('lb per acre').check();
    await form.getByLabel('Test method').selectOption('mehlich-1');
    await form.getByLabel('Soil pH').fill('6.2');
    await form.getByLabel('Phosphorus (P) (lb/A)').fill('300');
    await form.getByLabel('Potassium (K) (lb/A)').fill('600');
    await form.getByLabel(/Nitrate \(NO₃-N, lb\/A\)/).fill('100');
    await form.getByRole('button', { name: 'Save soil test' }).click();

    const history = page.locator('section.card', {
      has: page.getByRole('heading', { name: /History — soil tests/ })
    });
    await expect(history).toContainText('NO₃ 100, P 300, K 600', { timeout: 20_000 });
    await expect(history).toContainText('lb/A');

    const after = await preplantRate(page, blockId, farm.year);
    expect(after).toBeLessThan(before);
  });

  test('a helper is asked to get the owner to add it', async ({ page, browser }) => {
    const farm = await provisionWizardTenant(page, {
      seeds: [],
      blocks: [{ name: 'North Field', acres: 1 }]
    });
    const helper = await provisionHelper(page, browser);
    await helper.goto(`/fertility?block=${farm.blocks[0].id}`);
    // A click before the page hydrates does nothing, so retry until it opens.
    await expect(async () => {
      await helper.getByRole('button', { name: 'Add a soil test' }).click({ timeout: 2000 });
      await expect(helper.getByText('Ask the owner to add the soil test.')).toBeVisible({
        timeout: 1000
      });
    }).toPass();
    await expect(helper.getByTestId('setup-soil-test')).toHaveCount(0);
    await helper.context().close();
  });
});
