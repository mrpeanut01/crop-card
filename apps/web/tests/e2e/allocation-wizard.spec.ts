import type { Locator, Page, Request } from '@playwright/test';
import { test, expect } from './lib/test';
import {
  gotoPlanWithoutWizard,
  openWizardFromPlan,
  provisionWizardTenant
} from './lib/wizardTenant';

// Every spec provisions its own Owner (see lib/wizardTenant.ts) and runs the
// no-key deterministic path end to end: allocate, schedule and inputs all
// fall back to the engines, and the refine chat renders its "AI off"
// variant (the chat send path is covered by AllocationWizard.svelte.test.ts).

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

async function expectActiveStep(page: Page, label: string): Promise<void> {
  await expect(
    wizard(page).locator('ol[aria-label="Wizard steps"] [aria-current="step"]')
  ).toHaveAttribute('aria-label', label);
}

async function expectTableText(page: Page, expected: string): Promise<void> {
  await expect.poll(() => body(page).locator('table.aw-table tbody').innerText()).toBe(expected);
}

async function selectAllSeeds(page: Page): Promise<void> {
  for (const btn of await body(page)
    .getByRole('button', { name: /^Select all .* seeds$/ })
    .all()) {
    if (await btn.isEnabled()) await btn.click();
  }
}

async function goToBlocks(page: Page): Promise<void> {
  await selectAllSeeds(page);
  await footer(page)
    .getByRole('button', { name: /^Next: blocks/ })
    .click();
  await expectActiveStep(page, '2. Blocks');
}

async function goToReview(page: Page): Promise<void> {
  await goToBlocks(page);
  await body(page).getByRole('button', { name: 'Select all' }).click();
  await footer(page)
    .getByRole('button', { name: /^Generate plan \(2 blocks\)/ })
    .click();
  await expectActiveStep(page, '3. Review');
  await expect(body(page).locator('table.aw-table tbody tr').first()).toBeVisible();
}

async function goToSchedule(page: Page): Promise<void> {
  await goToReview(page);
  await footer(page).getByRole('button', { name: 'Accept all → schedule' }).click();
  await expectActiveStep(page, '4. Schedule');
  await expect(body(page).getByRole('columnheader', { name: 'Planting date' })).toBeVisible();
}

async function goToInputs(page: Page): Promise<void> {
  await goToSchedule(page);
  await footer(page)
    .getByRole('button', { name: /^Accept dates → inputs plan/ })
    .click();
  await expectActiveStep(page, '5. Inputs');
  await expect(body(page).getByRole('button', { name: /Accept and commit/ })).toBeVisible();
}

test.describe('allocation wizard', () => {
  test.describe.configure({ timeout: 90_000 });

  test('season setup: gates a first-run season, saves, and is re-editable from the chip', async ({
    page
  }) => {
    await provisionWizardTenant(page, { seasonSetup: false });
    await openWizardFromPlan(page);

    await expectActiveStep(page, '0. Season');
    await expect(body(page).getByText(/Set up your \d{4} planting season/)).toBeVisible();
    await expect(footer(page).getByRole('button', { name: /Keep current/ })).toHaveCount(0);

    await body(page)
      .locator('label', { hasText: 'Pest strategy' })
      .locator('select')
      .selectOption('minimal');
    await body(page).getByRole('button', { name: 'Save & continue' }).click();

    await expectActiveStep(page, '1. Seeds');
    const chip = wizard(page).locator('.aw-chip-row');
    await expect(chip).toContainText('Minimal');

    await chip.getByRole('button', { name: /Edit/ }).click();
    await expectActiveStep(page, '0. Season');
    await expect(
      body(page).locator('label', { hasText: 'Pest strategy' }).locator('select')
    ).toHaveValue('minimal');
    await footer(page).getByRole('button', { name: 'Keep current & continue' }).click();
    await expectActiveStep(page, '1. Seeds');
  });

  test('season setup: initialStep deep-link from the workflow strip reopens the form', async ({
    page
  }) => {
    await provisionWizardTenant(page, { seasonSetup: true });
    await gotoPlanWithoutWizard(page);
    await page.getByRole('button', { name: /Open the wizard at Season setup/ }).click();
    await expectActiveStep(page, '0. Season');
    await expect(body(page).getByRole('button', { name: 'Save changes & continue' })).toBeVisible();
    await footer(page).getByRole('button', { name: 'Keep current & continue' }).click();
    await expectActiveStep(page, '1. Seeds');
  });

  test('plan-state: existing plan offers continue vs start over', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: true, existingPlanting: true });
    await openWizardFromPlan(page);

    await expect(
      body(page).getByRole('heading', { name: 'You have a plan in place' })
    ).toBeVisible();
    await expect(body(page)).toContainText('Wizard Bed North: 1 planting');

    await body(page)
      .getByRole('button', { name: /Start over/ })
      .click();
    const confirm = page.getByRole('dialog', { name: 'Clear the current plan?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);

    await body(page)
      .getByRole('button', { name: /Continue planning/ })
      .click();
    await expect(body(page).getByText(/Pick the seed lots you want to plant/)).toBeVisible();
    await expect(body(page).getByRole('checkbox', { name: `Select ${BEAN}` })).toBeVisible();
  });

  test('plan-state: start over clears planned crops and lands on seeds', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: true, existingPlanting: true });
    await openWizardFromPlan(page);

    await body(page)
      .getByRole('button', { name: /Start over/ })
      .click();
    const confirm = page.getByRole('dialog', { name: 'Clear the current plan?' });
    const reset = page.waitForResponse(
      (r) => r.url().endsWith('/api/plan/reset') && r.request().method() === 'DELETE'
    );
    await confirm.getByRole('button', { name: 'Yes — clear the plan' }).click();
    expect((await reset).ok()).toBe(true);

    await expect(body(page).getByText(/Pick the seed lots you want to plant/)).toBeVisible();
    await footer(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(wizard(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Existing Beet Row')).toHaveCount(0);
  });

  test('seeds: empty stock renders the recovery card instead of a dead end', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: true, seeds: [] });
    await openWizardFromPlan(page);

    const empty = body(page).locator('[data-empty-state="seed-stock"]');
    await expect(empty.getByRole('heading', { name: 'No seed stock yet' })).toBeVisible();
    await expect(empty.getByRole('link', { name: /Add seed stock/ })).toHaveAttribute(
      'href',
      '/inventory/seed/add'
    );
    await expect(footer(page).getByRole('button', { name: /^Next: blocks/ })).toBeDisabled();
    await empty.getByRole('button', { name: /Skip — I’ll add seed stock later/ }).click();
    await expect(wizard(page)).toHaveCount(0);
  });

  test('seeds: selection, quantity, and search survive a round trip through blocks', async ({
    page
  }) => {
    await provisionWizardTenant(page, { seasonSetup: true });
    await openWizardFromPlan(page);
    await expectActiveStep(page, '1. Seeds');

    const next = footer(page).getByRole('button', { name: /^Next: blocks/ });
    await expect(next).toBeDisabled();
    await expect(next).toHaveText('Next: blocks (0 plants)');

    const bean = body(page).getByRole('checkbox', { name: `Select ${BEAN}` });
    await bean.check();
    await expect(next).toBeEnabled();
    await expect(next).toHaveText('Next: blocks (170 plants)');

    const beanRow = body(page).locator('tr', {
      has: page.getByRole('checkbox', { name: `Select ${BEAN}` })
    });
    const qty = beanRow.locator('input[type="number"]');
    await qty.fill('100');
    await expect(beanRow).toContainText('85');
    await expect(next).toHaveText('Next: blocks (85 plants)');

    await body(page).getByRole('searchbox', { name: 'Search seed lots' }).fill('beet');
    await expect(body(page).getByRole('checkbox', { name: `Select ${BEAN}` })).toHaveCount(0);
    await expect(body(page).getByText('1 of 2')).toBeVisible();
    await body(page).getByRole('searchbox', { name: 'Search seed lots' }).fill('');

    await next.click();
    await expectActiveStep(page, '2. Blocks');
    await footer(page).getByRole('button', { name: 'Back' }).click();
    await expectActiveStep(page, '1. Seeds');

    await expect(body(page).getByRole('checkbox', { name: `Select ${BEAN}` })).toBeChecked();
    await expect(body(page).getByRole('checkbox', { name: `Select ${BEET}` })).not.toBeChecked();
    await expect(
      body(page)
        .locator('tr', { has: page.getByRole('checkbox', { name: `Select ${BEAN}` }) })
        .locator('input[type="number"]')
    ).toHaveValue('100');
    await expect(footer(page).getByRole('button', { name: /^Next: blocks/ })).toHaveText(
      'Next: blocks (85 plants)'
    );
  });

  test('blocks: select all / clear / toggle, preserved across Back and Next', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: true });
    await openWizardFromPlan(page);
    await goToBlocks(page);

    const generate = footer(page).getByRole('button', { name: /^Generate plan/ });
    await expect(body(page)).toContainText('0 of 2 selected');
    await expect(generate).toBeDisabled();

    await body(page).getByRole('button', { name: 'Select all' }).click();
    await expect(body(page)).toContainText('2 of 2 selected');
    await expect(generate).toHaveText('Generate plan (2 blocks)');

    await body(page).getByRole('button', { name: 'Clear' }).click();
    await expect(body(page)).toContainText('0 of 2 selected');

    await body(page)
      .getByRole('checkbox', { name: /Wizard Bed South/ })
      .check();
    await expect(generate).toHaveText('Generate plan (1 blocks)');

    await footer(page).getByRole('button', { name: 'Back' }).click();
    await expectActiveStep(page, '1. Seeds');
    await footer(page)
      .getByRole('button', { name: /^Next: blocks/ })
      .click();
    await expectActiveStep(page, '2. Blocks');
    await expect(body(page).getByRole('checkbox', { name: /Wizard Bed South/ })).toBeChecked();
    await expect(body(page).getByRole('checkbox', { name: /Wizard Bed North/ })).not.toBeChecked();
    await expect(generate).toHaveText('Generate plan (1 blocks)');
  });

  test('review: deterministic allocation renders with fallback provenance + AI-off chat', async ({
    page
  }) => {
    await provisionWizardTenant(page, { seasonSetup: true });
    await openWizardFromPlan(page);
    await goToReview(page);

    await expect(body(page).getByRole('alert').first()).toContainText(
      'No Anthropic API key configured'
    );
    await expect(body(page)).toContainText('AI off · deterministic allocator');
    for (const col of ['Seed', 'Block', 'Plants', 'Block fit', 'Why', 'Source']) {
      await expect(body(page).getByRole('columnheader', { name: col, exact: true })).toBeVisible();
    }
    const chat = body(page).getByRole('region', { name: 'Refine plan with AI' });
    await expect(chat.getByRole('heading', { name: 'AI assistant is off' })).toBeVisible();
    await expect(chat.getByRole('log')).toContainText('Tell me anything you');
    await expect(chat.getByRole('textbox')).toHaveCount(0);

    const rowsBefore = await body(page).locator('table.aw-table tbody').innerText();
    const regen = page.waitForResponse((r) => r.url().endsWith('/api/plan/allocate'));
    await footer(page).getByRole('button', { name: 'Regenerate' }).click();
    expect((await regen).ok()).toBe(true);
    await expectTableText(page, rowsBefore);

    await footer(page).getByRole('button', { name: 'Back' }).click();
    await expectActiveStep(page, '2. Blocks');
    await expect(body(page)).toContainText('2 of 2 selected');
  });

  test('schedule: dated rows render; Back to allocation keeps the plan without regenerating', async ({
    page
  }) => {
    await provisionWizardTenant(page, { seasonSetup: true });
    await openWizardFromPlan(page);
    await goToReview(page);
    const allocationRows = await body(page).locator('table.aw-table tbody').innerText();

    await footer(page).getByRole('button', { name: 'Accept all → schedule' }).click();
    await expectActiveStep(page, '4. Schedule');
    await expect(body(page)).toContainText('AI off · deterministic scheduler');
    await expect(body(page).getByRole('alert').first()).toContainText(
      'Dates picked by the deterministic scheduler'
    );
    const scheduleRows = body(page).locator('table.aw-table tbody tr');
    await expect(scheduleRows.first()).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
    const accept = footer(page).getByRole('button', { name: /^Accept dates → inputs plan/ });
    await expect(accept).toHaveText(`Accept dates → inputs plan (${await scheduleRows.count()})`);

    let allocateCalls = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/api/plan/allocate')) allocateCalls++;
    });
    await footer(page).getByRole('button', { name: 'Back to allocation' }).click();
    await expectActiveStep(page, '3. Review');
    await expectTableText(page, allocationRows);
    expect(allocateCalls).toBe(0);

    const reschedule = page.waitForResponse((r) => r.url().endsWith('/api/plan/schedule'));
    await footer(page).getByRole('button', { name: 'Accept all → schedule' }).click();
    expect((await reschedule).ok()).toBe(true);
    await expectActiveStep(page, '4. Schedule');

    const again = page.waitForResponse((r) => r.url().endsWith('/api/plan/schedule'));
    await footer(page).getByRole('button', { name: 'Re-schedule' }).click();
    expect((await again).ok()).toBe(true);
    await expect(body(page).locator('table.aw-table tbody tr').first()).toBeVisible();
  });

  test('inputs: deterministic plan renders; Back to schedule keeps the dates', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: true });
    await openWizardFromPlan(page);
    await goToSchedule(page);
    const scheduleRows = await body(page).locator('table.aw-table tbody').innerText();

    await footer(page)
      .getByRole('button', { name: /^Accept dates → inputs plan/ })
      .click();
    await expectActiveStep(page, '5. Inputs');
    await expect(body(page).getByRole('heading', { name: 'Inputs plan' })).toBeVisible();
    await expect(body(page)).toContainText('Showing the deterministic plan');
    await expect(body(page)).toContainText('Shopping list');
    await expect(body(page)).toContainText(/Accepting \d+ applications?\s+\+ \d+ scout tasks?/);

    await body(page).getByRole('button', { name: '← Back to schedule' }).click();
    await expectActiveStep(page, '4. Schedule');
    await expectTableText(page, scheduleRows);
  });

  test('header stepper jumps back to a done step and keeps later state', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: true });
    await openWizardFromPlan(page);
    await goToSchedule(page);

    const steps = wizard(page).locator('ol[aria-label="Wizard steps"]');
    await steps.getByRole('button', { name: '6. Commit' }).click();
    await expectActiveStep(page, '4. Schedule');

    await steps.getByRole('button', { name: '1. Seeds' }).click();
    await expectActiveStep(page, '1. Seeds');
    await expect(body(page).getByRole('checkbox', { name: `Select ${BEAN}` })).toBeChecked();
    await expect(body(page).getByRole('checkbox', { name: `Select ${BEET}` })).toBeChecked();
  });

  test('save & resume later restores step and selections', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: true });
    await openWizardFromPlan(page);
    await goToBlocks(page);
    await body(page)
      .getByRole('checkbox', { name: /Wizard Bed North/ })
      .check();

    const save = page.waitForResponse(
      (r) => r.url().endsWith('/api/plan/wizard/draft') && r.request().method() === 'POST'
    );
    await wizard(page).getByRole('button', { name: 'Save & resume later' }).click();
    expect((await save).ok()).toBe(true);
    await expect(wizard(page)).toHaveCount(0);

    await openWizardFromPlan(page);
    await expectActiveStep(page, '2. Blocks');
    await expect(body(page).getByRole('checkbox', { name: /Wizard Bed North/ })).toBeChecked();
    await expect(body(page).getByRole('checkbox', { name: /Wizard Bed South/ })).not.toBeChecked();
    await footer(page).getByRole('button', { name: 'Back' }).click();
    await expect(body(page).getByRole('checkbox', { name: `Select ${BEAN}` })).toBeChecked();
  });

  test('Escape closes the wizard', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: true });
    await openWizardFromPlan(page);
    await expectActiveStep(page, '1. Seeds');
    await page.keyboard.press('Escape');
    await expect(wizard(page)).toHaveCount(0);
  });

  test('happy path: season setup → allocation → schedule → inputs → commit → /plan', async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await provisionWizardTenant(page, { seasonSetup: false });
    await openWizardFromPlan(page);

    await expectActiveStep(page, '0. Season');
    await body(page).getByRole('button', { name: 'Save & continue' }).click();
    await expectActiveStep(page, '1. Seeds');

    await goToInputs(page);

    const plantingPosts: string[] = [];
    let dataLoadsInFlight = 0;
    const isDataLoad = (url: string) => /\/__data\.json/.test(url);
    page.on('request', (r) => {
      if (isDataLoad(r.url())) dataLoadsInFlight++;
    });
    const settled = (r: Request) => {
      if (isDataLoad(r.url())) dataLoadsInFlight--;
    };
    page.on('requestfinished', settled);
    page.on('requestfailed', settled);
    page.on('request', (r) => {
      if (/\/api\/blocks\/[^/]+\/plantings$/.test(r.url()) && r.method() === 'POST') {
        plantingPosts.push(r.postData() ?? '');
      }
    });
    const inputsCommit = page.waitForResponse((r) => r.url().endsWith('/api/plan/inputs/commit'));
    await body(page)
      .getByRole('button', { name: /Accept and commit/ })
      .click();
    expect((await inputsCommit).ok()).toBe(true);
    await expect(wizard(page)).toHaveCount(0);

    expect(plantingPosts.length).toBeGreaterThan(0);
    for (const p of plantingPosts) {
      const payload = JSON.parse(p) as { plantingDate?: number; sourceProvenance?: string };
      expect(typeof payload.plantingDate).toBe('number');
      expect(payload.sourceProvenance).toBe('fallback');
    }

    await expect.poll(() => dataLoadsInFlight).toBe(0);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(BEAN).first()).toBeVisible();
    await expect(page.getByText(/Committed \d+ applications/)).toBeVisible();

    await page
      .getByRole('button', { name: /^Open wizard/ })
      .first()
      .click();
    await expect(
      body(page).getByRole('heading', { name: 'You have a plan in place' })
    ).toBeVisible();

    expect(errors.filter((m) => !/404/.test(m))).toEqual([]);
  });
});

test.describe('empty season starts in the wizard', () => {
  test.describe.configure({ timeout: 90_000 });

  test('skipping the farm map opens the wizard, and blocks can be added inline', async ({
    page
  }) => {
    await provisionWizardTenant(page, { seasonSetup: true, blocks: [] });
    await page.goto('/plan/farm');
    await page.getByRole('link', { name: 'Skip the map and plan by block name' }).click();
    await page.waitForURL(/\/plan\?setup=skip$/);
    await page.waitForLoadState('networkidle');

    await expect(wizard(page)).toBeVisible();
    await expectActiveStep(page, '1. Seeds');
    await goToBlocks(page);

    const empty = body(page).locator('[data-empty-state="blocks"]');
    await expect(empty.getByRole('heading', { name: 'Add your first block' })).toBeVisible();
    const form = body(page).getByTestId('wizard-add-block');
    await form.getByLabel('Block name').fill('Kitchen Garden');
    await form.getByRole('button', { name: '+ Add block' }).click();

    await expect(body(page).getByLabel('Kitchen Garden')).toBeChecked();
    await expect(
      footer(page).getByRole('button', { name: /^Generate plan \(1 blocks\)/ })
    ).toBeEnabled();

    await page.keyboard.press('Escape');
    await expect(wizard(page)).toHaveCount(0);
  });

  test('closing the auto-opened wizard leaves a start card that reopens it', async ({ page }) => {
    await provisionWizardTenant(page, { seasonSetup: true, blocks: [] });
    await gotoPlanWithoutWizard(page);

    const card = page.locator('[data-empty-state="season-start"]');
    await expect(card.getByRole('heading', { name: /Plan your \d{4} season/ })).toBeVisible();
    await card.getByRole('button', { name: 'Start the planning wizard' }).click();
    await expect(wizard(page)).toBeVisible();
  });

  test('carry-forward shows last season and skips the plan-in-place gate', async ({ page }) => {
    const { year } = await provisionWizardTenant(page, {
      seasonSetup: false,
      priorPlanting: true
    });
    await page.goto('/plan');
    await page.waitForLoadState('networkidle');

    await expect(wizard(page)).toBeVisible();
    await expectActiveStep(page, '0. Season');
    const prior = body(page).getByTestId('prior-season-panel');
    await expect(prior.getByRole('heading', { name: `Last season (${year - 1})` })).toBeVisible();
    await expect(prior.getByText('Last Year Beans')).toBeVisible();

    await body(page).getByRole('button', { name: 'Save & continue' }).click();
    await expectActiveStep(page, '1. Seeds');
    await goToBlocks(page);
    await expect(body(page).getByText(`${year - 1}: Last Year Beans`)).toBeVisible();
  });
});

test('an empty season deep link (?map=open) does not stack the wizard on top', async ({ page }) => {
  await provisionWizardTenant(page, { seasonSetup: true });
  await page.goto('/plan?map=open');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(wizard(page)).toHaveCount(0);
});
