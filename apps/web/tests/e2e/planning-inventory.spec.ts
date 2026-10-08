import type { Locator, Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { openWizardFromPlan, provisionWizardTenant } from './lib/wizardTenant';
import { provisionHelper } from './lib/freshFarm';

// Wave 1 planning cluster: #471 (zero-quantity seed shows and sizes to the
// bed), #475 (ordered and planned quantities, add seed and edit blocks
// without leaving the wizard, setup nudges on /plan) and #480 (inputs pick
// on-hand products first and the farmer can change the product). Every
// step runs the no-key deterministic path.

const BEAN = 'Bush Bean — Provider';
const BEET = 'Beet — Detroit Dark Red';

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
function seedRow(page: Page, name: string): Locator {
  return body(page).locator('tr', { has: page.getByRole('checkbox', { name: `Select ${name}` }) });
}

test.describe('planning from inventory', () => {
  test.describe.configure({ timeout: 120_000 });

  test('#471 a seed with no quantity shows, sizes to the bed and gets planned', async ({
    page
  }) => {
    await provisionWizardTenant(page, {
      seasonSetup: true,
      seeds: [
        { displayName: BEAN, pluginId: 'bush-bean-provider', quantity: 0 },
        { displayName: BEET, pluginId: 'beet-detroit-dark-red', quantity: 300 }
      ]
    });
    await openWizardFromPlan(page);

    const bean = seedRow(page, BEAN);
    await expect(bean.getByTestId('seed-available')).toHaveText('Not counted yet');
    await bean.getByRole('checkbox').check();
    await expect(bean.getByTestId('fill-to-bed')).toContainText(
      'Quantity not set, will size to bed'
    );
    const next = footer(page).getByRole('button', { name: /^Next: blocks/ });
    await expect(next).toContainText('1 sized to bed');
    await next.click();
    await body(page).getByRole('button', { name: 'Select all' }).click();
    const allocate = page.waitForResponse((r) => r.url().endsWith('/api/plan/allocate'));
    await footer(page)
      .getByRole('button', { name: /^Generate plan/ })
      .click();
    const res = await allocate;
    const json = (await res.json()) as { assignments: Array<{ varietyDisplayName: string }> };
    expect(json.assignments.map((a) => a.varietyDisplayName)).toContain(BEAN);
    await expect(body(page).locator('table.aw-table tbody')).toContainText(BEAN);
  });

  test('seed rows are 48px targets at phone width and the name selects the seed', async ({
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await provisionWizardTenant(page, {
      seasonSetup: true,
      seeds: [{ displayName: BEAN, pluginId: 'bush-bean-provider', quantity: 200 }]
    });
    await openWizardFromPlan(page);
    const bean = seedRow(page, BEAN);
    const pick = await bean.locator('label.seed-pick').boundingBox();
    expect(pick!.width).toBeGreaterThanOrEqual(48);
    expect(pick!.height).toBeGreaterThanOrEqual(48);
    await bean.locator('label.seed-name-cell').click();
    await expect(bean.getByRole('checkbox')).toBeChecked();
    await expect(footer(page).getByRole('button', { name: /^Next: blocks/ })).toBeEnabled();
  });

  test('#475 ordered and planned seed count toward the plan but not on hand', async ({ page }) => {
    const tenant = await provisionWizardTenant(page, {
      seasonSetup: true,
      seeds: [{ displayName: BEET, pluginId: 'beet-detroit-dark-red', quantity: 20 }]
    });
    const beet = tenant.seeds[0].id;
    for (const [quantityStatus, receivedQuantity] of [
      ['ordered', 50],
      ['planned', 30]
    ] as const) {
      const r = await page.request.post(`/api/stock/${beet}/lots`, {
        data: { receivedQuantity, unit: 'seeds', quantityStatus },
        headers: { origin: origin(page) }
      });
      expect(r.status()).toBe(201);
    }

    await openWizardFromPlan(page);
    const row = seedRow(page, BEET);
    await expect(row.getByTestId('seed-available')).toHaveText(
      '20 seeds on hand + 50 seeds ordered + 30 seeds planned'
    );
    await row.getByRole('checkbox').check();
    await expect(row.locator('input[type="number"]')).toHaveValue('100');
    await page.keyboard.press('Escape');

    await page.goto(`/inventory/seed/${beet}`);
    await page.waitForLoadState('networkidle');
    const qty = page.getByTestId('lot-quantities');
    await expect(qty).toContainText('On hand');
    await expect(qty.locator('li[data-status="ordered"]')).toContainText('50');
    await qty
      .locator('li[data-status="ordered"]')
      .getByRole('button', { name: 'Mark received' })
      .click();
    await expect(qty.locator('li[data-status="ordered"]')).toHaveCount(0);
    const stock = await page.request.get('/api/stock');
    const item = (
      (await stock.json()) as { items: Array<{ id: string; onHand: number }> }
    ).items.find((i) => i.id === beet);
    expect(item?.onHand).toBe(70);
  });

  test('#475 add a seed and resize a block without leaving the wizard', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: true, seeds: [] });
    await openWizardFromPlan(page);

    await body(page)
      .locator('[data-empty-state="seed-stock"]')
      .getByRole('button', { name: 'Add seed', exact: true })
      .click();
    const sheet = page.locator('dialog.setup-sheet[open]');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('tab', { name: /Type it in/ }).click();
    await sheet.locator('#displayName').fill('Cherokee Purple');
    await sheet.getByRole('combobox', { name: /Category/ }).fill('bush bean provider');
    await sheet.getByRole('option', { name: /Bush Bean . Provider/ }).click();
    await sheet.locator('#quantity').fill('40');
    await sheet.locator('#initialStatus').selectOption('ordered');
    await sheet.getByRole('button', { name: /Create seed/ }).click();
    await expect(sheet).toHaveCount(0);
    await expect(wizard(page)).toBeVisible();

    const row = seedRow(page, 'Cherokee Purple');
    await expect(row.getByRole('checkbox')).toBeChecked();
    await expect(row.getByTestId('seed-available')).toHaveText('40 seeds ordered');

    await footer(page)
      .getByRole('button', { name: /^Next: blocks/ })
      .click();
    await body(page)
      .locator('li', { hasText: 'Wizard Bed North' })
      .getByRole('button', { name: 'Edit' })
      .click();
    const modal = page.getByRole('dialog', { name: 'Edit block' });
    await modal.getByLabel('Width').fill('4');
    await modal.getByLabel('Length').fill('8');
    await modal.getByRole('button', { name: 'Save changes' }).click();
    await expect(modal).toHaveCount(0);
    await expect(wizard(page)).toBeVisible();
    await expect(
      body(page).locator('li', { hasText: 'Wizard Bed North' }).locator('.aw-chip').first()
    ).toContainText('4 ft × 8 ft');
  });

  test('#475 Edit block fits a phone and its area follows width and length', async ({ page }) => {
    await provisionWizardTenant(page, {
      seasonSetup: true,
      seeds: [{ displayName: BEET, pluginId: 'beet-detroit-dark-red', quantity: 300 }]
    });
    await page.setViewportSize({ width: 375, height: 800 });
    await openWizardFromPlan(page);
    await seedRow(page, BEET).getByRole('checkbox').check();
    await footer(page)
      .getByRole('button', { name: /^Next: blocks/ })
      .click();
    await body(page)
      .locator('li', { hasText: 'Wizard Bed North' })
      .getByRole('button', { name: 'Edit' })
      .click();
    const modal = page.getByRole('dialog', { name: 'Edit block' });
    await modal.getByLabel('Width').fill('4');
    await modal.getByLabel('Length').fill('8');
    const fits = await modal.evaluate((el) => {
      const right = el.getBoundingClientRect().right;
      const inputs = [...el.querySelectorAll('.dims .unit-input')];
      return {
        scroll: el.scrollWidth - el.clientWidth,
        past: inputs.filter((i) => i.getBoundingClientRect().right > right + 0.5).length
      };
    });
    expect(fits).toEqual({ scroll: 0, past: 0 });
    await expect(modal.getByTestId('edit-block-area')).toBeDisabled();
    await expect(modal.getByText('Worked out from the width and length.')).toBeVisible();
    const patch = page.waitForRequest(
      (r) => r.method() === 'PATCH' && r.url().includes('/api/blocks/')
    );
    await modal.getByRole('button', { name: 'Save changes' }).click();
    const sent = (await patch).postDataJSON() as Record<string, unknown>;
    expect(sent).toMatchObject({ widthFt: 4, lengthFt: 8 });
    expect(sent).not.toHaveProperty('acres');
  });

  test('#480 inputs pick the fertilizer on hand, and the farmer can change it', async ({
    page
  }) => {
    await provisionWizardTenant(page, {
      seasonSetup: true,
      seeds: [{ displayName: BEAN, pluginId: 'bush-bean-provider', quantity: 200 }]
    });
    const create = await page.request.post('/api/stock', {
      data: {
        category: 'fertilizer',
        displayName: 'Bone meal',
        defaultUnit: 'lb',
        pluginId: 'bone-meal-3-15-0'
      },
      headers: { origin: origin(page) }
    });
    const { item } = (await create.json()) as { item: { id: string } };
    await page.request.post(`/api/stock/${item.id}/set-quantity`, {
      data: { quantity: 500 },
      headers: { origin: origin(page) }
    });

    await openWizardFromPlan(page);
    await seedRow(page, BEAN).getByRole('checkbox').check();
    await footer(page)
      .getByRole('button', { name: /^Next: blocks/ })
      .click();
    await body(page).getByRole('button', { name: 'Select all' }).click();
    await footer(page)
      .getByRole('button', { name: /^Generate plan/ })
      .click();
    await expect(body(page).locator('table.aw-table tbody tr').first()).toBeVisible();
    await footer(page).getByRole('button', { name: 'Accept all → schedule' }).click();
    await footer(page)
      .getByRole('button', { name: /^Accept dates → inputs plan/ })
      .click();
    await expect(body(page).getByRole('button', { name: /Accept and commit/ })).toBeVisible();

    const select = body(page).getByTestId('product-select').first();
    // A bean's budget is phosphorus and potassium, so the on-hand product has
    // to supply one of them; blood meal (12-0-0) is not offered for it.
    await expect(select).toHaveValue('bone-meal-3-15-0');
    await expect(select.locator('option[value="blood-meal-12-0-0"]')).toHaveCount(0);
    await expect(select.locator('option:checked')).toHaveText(/^Bone Meal.*on hand\)$/);

    const other = await select
      .locator('option')
      .evaluateAll((opts) =>
        opts.map((o) => (o as HTMLOptionElement).value).find((v) => v && v !== 'bone-meal-3-15-0')
      );
    expect(other).toBeTruthy();
    await select.selectOption(other!);
    await expect(select).toHaveValue(other!);
    await expect(
      body(page).locator('.app-row').first().locator('[data-provenance="manual"]')
    ).toBeVisible();
    await expect(body(page).locator('aside.shopping')).not.toContainText('Bone meal');
  });

  test('#475 /plan asks the setup questions a partly set up farm skipped', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: false, seeds: [] });
    await page.goto('/plan?setup=skip');
    await page.waitForLoadState('networkidle');
    if (await wizard(page).isVisible()) await page.keyboard.press('Escape');

    const nudges = page.getByTestId('setup-nudges');
    await expect(nudges).toContainText('Finish setting up');
    await nudges.locator('summary').click();
    await expect(nudges.locator('[data-nudge="season"]')).toContainText('season is not set up');
    await expect(
      nudges.locator('[data-nudge="seed"]').getByRole('link', { name: 'Add seed' })
    ).toHaveAttribute('href', '/inventory/seed/add');
    await nudges
      .locator('[data-nudge="season"]')
      .getByRole('button', { name: /^Not now/ })
      .click();
    await expect(nudges.locator('[data-nudge="season"]')).toHaveCount(0);
  });

  test('#475 a helper gets no setup questions they cannot answer', async ({ page, browser }) => {
    await provisionWizardTenant(page, { seasonSetup: false, seeds: [] });
    const helper = await provisionHelper(page, browser);
    await helper.goto('/plan?setup=skip');
    await helper.waitForLoadState('networkidle');
    await expect(helper.getByTestId('setup-nudges')).toHaveCount(0);
    await helper.goto('/today');
    await helper.waitForLoadState('networkidle');
    await expect(helper.getByTestId('setup-nudges')).toHaveCount(0);
    await helper.context().close();
  });

  test('#475 /plan answers the season and farm location questions in place', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: false, seeds: [] });
    await page.goto('/plan?setup=skip');
    await page.waitForLoadState('networkidle');
    if (await wizard(page).isVisible()) await page.keyboard.press('Escape');

    const nudges = page.getByTestId('setup-nudges');
    await expect(nudges.locator('summary')).toContainText(/questions/);
    await nudges.locator('summary').click();

    await nudges.locator('[data-nudge="season"]').getByRole('button').first().click();
    const seasonSheet = page.locator('dialog.setup-sheet[open]');
    await expect(seasonSheet).toContainText(/Set up the \d{4} season/);
    await seasonSheet.getByRole('button', { name: /^Save/ }).click();
    await expect(seasonSheet).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/plan/);
    await expect(nudges.locator('[data-nudge="season"]')).toHaveCount(0);

    if (!(await nudges.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await nudges.locator('summary').click();
    }
    await nudges
      .locator('[data-nudge="location"]')
      .getByRole('button', { name: 'Set farm location' })
      .click();
    const climate = page.getByTestId('setup-farm-climate');
    await climate.getByLabel('Latitude').fill('39.137');
    await climate.getByLabel('Longitude').fill('-77.714');
    const save = climate.getByRole('button', { name: 'Save location and frost dates' });
    await expect(save).toBeEnabled({ timeout: 15_000 });
    await save.click();
    await expect(climate).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-nudge="location"]')).toHaveCount(0);
    await expect(page.locator('[data-nudge="frost"]')).toHaveCount(0);
    const settings = await page.request.get('/api/settings');
    expect(JSON.stringify(await settings.json())).toContain('39.137');
  });

  test('counted seed bigger than the bed still fills it, and the rest is left over', async ({
    page
  }) => {
    await provisionWizardTenant(page, {
      seasonSetup: true,
      blocks: [{ name: 'Tiny bed', acres: 40 / 43_560 }],
      seeds: [{ displayName: BEAN, pluginId: 'bush-bean-provider', quantity: 2000 }]
    });
    await openWizardFromPlan(page);
    await seedRow(page, BEAN).getByRole('checkbox').check();
    await footer(page)
      .getByRole('button', { name: /^Next: blocks/ })
      .click();
    await body(page).getByRole('button', { name: 'Select all' }).click();
    await expect(body(page).getByTestId('space-check')).toContainText('40 sq ft');
    await expect(body(page).getByTestId('space-check')).not.toContainText(' 0 ac');
    const allocate = page.waitForResponse((r) => r.url().endsWith('/api/plan/allocate'));
    await footer(page)
      .getByRole('button', { name: /^Generate plan/ })
      .click();
    const json = (await (await allocate).json()) as {
      assignments: Array<{ plants: number }>;
      unplaced: Array<{ quantityPlants: number }>;
    };
    expect(json.assignments.length).toBeGreaterThan(0);
    expect(json.unplaced[0].quantityPlants).toBeGreaterThan(0);
    await expect(body(page)).toContainText("didn't fit in the blocks you picked");
    await expect(footer(page).getByRole('button', { name: 'Accept all → schedule' })).toBeEnabled();
  });

  test('#475 the Blocks step suggests beds sized for the seed and adds them', async ({ page }) => {
    await provisionWizardTenant(page, {
      seasonSetup: true,
      blocks: [],
      seeds: [
        { displayName: BEAN, pluginId: 'bush-bean-provider', quantity: 400 },
        { displayName: BEET, pluginId: 'beet-detroit-dark-red', quantity: 300 }
      ]
    });
    const garden = await page.request.post('/api/fields', {
      data: { name: 'Kitchen Garden', kind: 'garden', widthFt: 60, lengthFt: 100 },
      headers: { origin: origin(page) }
    });
    const { field } = (await garden.json()) as { field: { id: string } };
    for (const name of ['Bed 1', 'Bed 2']) {
      const res = await page.request.post('/api/blocks', {
        data: { name, fieldId: field.id, kind: 'bed', widthFt: 2.5, lengthFt: 20 },
        headers: { origin: origin(page) }
      });
      expect(res.ok()).toBe(true);
    }
    await openWizardFromPlan(page);
    await seedRow(page, BEAN).getByRole('checkbox').check();
    await seedRow(page, BEET).getByRole('checkbox').check();
    await footer(page)
      .getByRole('button', { name: /^Next: blocks/ })
      .click();
    const beds = body(page).getByTestId('bed-suggest');
    await expect(beds.getByTestId('bed-suggest-start')).toContainText(
      'Starting from your beds in Kitchen Garden: 2.5 ft wide and up to 20 ft long'
    );
    const suggested = page.waitForResponse((r) => r.url().endsWith('/api/plan/beds/suggest'));
    await beds.getByRole('button', { name: 'Suggest beds' }).click();
    const json = (await (await suggested).json()) as {
      provenance: string;
      beds: Array<{ widthFt: number; lengthFt: number; crops: Array<{ plants: number }> }>;
    };
    expect(json.provenance).toBe('fallback');
    expect(json.beds.length).toBeGreaterThan(0);
    for (const b of json.beds) expect(b.lengthFt).toBeLessThanOrEqual(20 + 1);
    await expect(beds.locator('[data-provenance="fallback"]').first()).toBeVisible();
    await expect(beds.locator('.aw-bed-head').first()).toContainText('Bed 3: 2.5 ft ×');
    await expect(beds.getByTestId('bed-suggest-overfull')).toHaveCount(0);
    const add = beds.getByRole('button', { name: /^Add (this bed|these \d+ beds)/ });
    expect((await add.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await add.click();
    await expect(beds.getByRole('status')).toContainText(
      `Added ${json.beds.length} ${json.beds.length === 1 ? 'bed' : 'beds'}`
    );
    await expect(body(page).locator('.aw-blocklist li')).toHaveCount(json.beds.length + 2);
    await expect(body(page).locator('.aw-blocklist li', { hasText: 'Bed 3' })).toContainText(
      '2.5 ft ×'
    );
    await expect(body(page).locator('.aw-blocklist li.checked')).toHaveCount(json.beds.length, {
      timeout: 10_000
    });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  });

  test('#693 no bed suggestions on a field farm; beds that overfill the Area cannot be added', async ({
    page
  }) => {
    await provisionWizardTenant(page, {
      seasonSetup: true,
      blocks: [{ name: 'North field', acres: 5 }],
      seeds: [{ displayName: BEAN, pluginId: 'bush-bean-provider', quantity: 4000 }]
    });
    await openWizardFromPlan(page);
    await seedRow(page, BEAN).getByRole('checkbox').check();
    await footer(page)
      .getByRole('button', { name: /^Next: blocks/ })
      .click();
    await expect(body(page).locator('.aw-blocklist li')).toHaveCount(1);
    await expect(body(page).getByTestId('bed-suggest')).toHaveCount(0);

    await page.request.post('/api/fields', {
      data: { name: 'Tiny Tunnel', kind: 'greenhouse', widthFt: 10, lengthFt: 10 },
      headers: { origin: origin(page) }
    });
    await openWizardFromPlan(page);
    await seedRow(page, BEAN).getByRole('checkbox').check();
    await footer(page)
      .getByRole('button', { name: /^Next: blocks/ })
      .click();
    const beds = body(page).getByTestId('bed-suggest');
    await expect(beds.getByTestId('bed-suggest-start')).toContainText('4 ft wide');
    await beds.getByRole('button', { name: 'Suggest beds' }).click();
    await expect(beds.getByTestId('bed-suggest-overfull')).toContainText('Tiny Tunnel');
    await expect(
      beds.getByRole('button', { name: /^Add (this bed|these \d+ beds)/ })
    ).toBeDisabled();
  });

  test('a block added in the wizard goes in the Area the owner picks', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: true });
    const garden = await page.request.post('/api/fields', {
      data: { name: 'Kitchen Garden', kind: 'garden' },
      headers: { origin: origin(page) }
    });
    const { field } = (await garden.json()) as { field: { id: string } };
    await openWizardFromPlan(page);
    await seedRow(page, BEAN).getByRole('checkbox').check();
    await footer(page)
      .getByRole('button', { name: /^Next: blocks/ })
      .click();
    const form = body(page).getByTestId('wizard-add-block');
    await form.getByTestId('wizard-add-block-area').selectOption(field.id);
    await form.getByRole('textbox').first().fill('Bed 1');
    await form.getByRole('button', { name: '+ Add block' }).click();
    await expect(body(page).locator('li', { hasText: 'Bed 1' })).toBeVisible();
    const blocks = (await (await page.request.get('/api/blocks')).json()) as {
      blocks: Array<{ name: string; fieldId?: string | null; kind?: string }>;
    };
    const bed = blocks.blocks.find((b) => b.name === 'Bed 1');
    expect(bed?.fieldId).toBe(field.id);
    expect(bed?.kind).toBe('bed');
  });

  test('at 375px the seeds and inputs steps fit without sideways scrolling', async ({ page }) => {
    await provisionWizardTenant(page, {
      seasonSetup: true,
      seeds: [{ displayName: BEAN, pluginId: 'bush-bean-provider', quantity: 200 }]
    });
    await page.setViewportSize({ width: 375, height: 800 });
    await openWizardFromPlan(page);
    const fits = async (label: string) => {
      const over = await body(page).evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(over, label).toBeLessThanOrEqual(1);
    };
    await expect(seedRow(page, BEAN)).toBeVisible();
    await fits('seeds');
    await seedRow(page, BEAN).getByRole('checkbox').check();
    await footer(page)
      .getByRole('button', { name: /^Next: blocks/ })
      .click();
    await body(page).getByRole('button', { name: 'Select all' }).click();
    await footer(page)
      .getByRole('button', { name: /^Generate plan/ })
      .click();
    await expect(body(page).locator('table.aw-table tbody tr').first()).toBeVisible();
    await footer(page).getByRole('button', { name: 'Accept all → schedule' }).click();
    await footer(page)
      .getByRole('button', { name: /^Accept dates → inputs plan/ })
      .click();
    await expect(body(page).getByRole('button', { name: /Accept and commit/ })).toBeVisible();
    await fits('inputs');
    const select = body(page).getByTestId('product-select').first();
    if (await select.count()) {
      const box = await select.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }
  });
});
