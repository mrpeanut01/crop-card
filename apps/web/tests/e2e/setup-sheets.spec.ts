import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';

// Phase 30C: setup happens inside the flow that needs it. A brand-new farm
// has no blocks, plantings, sprayers or stock, and every entry point below
// offers to add the missing piece in a sheet without leaving the page.

function sheet(page: Page, title: string) {
  return page.getByRole('dialog', { name: title });
}

async function nameSpot(page: Page, dialog: ReturnType<typeof sheet>, name: string, kind: RegExp) {
  await dialog.getByLabel('What do you call it?').fill(name);
  await dialog.getByRole('radio', { name: kind }).check();
}

test.describe('just-in-time setup', () => {
  test.describe.configure({ timeout: 120_000 });

  test('spray: add what is growing, add and calibrate a sprayer, then record, all on /spray', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    await page.goto('/spray');
    await page.waitForLoadState('networkidle');

    const where = page.getByTestId('spray-where');
    await expect(where.getByRole('heading', { name: 'What are you spraying?' })).toBeVisible();
    await where.getByRole('button', { name: "Add what's growing" }).click();

    const growing = sheet(page, "What's growing there?");
    await expect(growing.getByText('First, where is it growing?')).toBeVisible();
    await nameSpot(page, growing, 'North 10', /^Field/);
    await growing.getByRole('button', { name: 'Save and continue' }).click();
    await growing.getByLabel('What is it?').fill('Bodacious');
    await growing.getByRole('button', { name: /Bodacious Sweet Corn/ }).click();
    await expect(growing.getByLabel('Where is it growing?')).toHaveValue(/.+/);
    await growing.getByRole('button', { name: 'Save and pick products' }).click();
    await expect(growing).toBeHidden();
    await expect(page).toHaveURL(/\/spray$/);

    await expect(page.getByRole('button', { name: /North 10/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    const empty = page.getByTestId('sprayer-empty');
    await expect(empty.getByText('Which sprayer?')).toBeVisible();
    await empty.getByRole('button', { name: '+ Add a sprayer' }).click();

    const sprayerSheet = sheet(page, 'Which sprayer?');
    await expect(sprayerSheet.locator('button.tile')).toHaveCount(6);
    await sprayerSheet.getByLabel(/Name it/).fill('Old Blue');
    await sprayerSheet.locator('button[data-template="sprayer-backpack-4gal"]').click();
    await expect(sprayerSheet.getByText(/needs calibrating/)).toBeVisible();

    const created = await page.request.get('/api/equipment?type=sprayer');
    const { equipment } = (await created.json()) as {
      equipment: Array<{
        label: string;
        spec?: { templateId?: string };
        state: { calibratedGpa?: number };
      }>;
    };
    expect(equipment).toHaveLength(1);
    expect(equipment[0].label).toBe('Old Blue');
    expect(equipment[0].spec?.templateId).toBe('sprayer-backpack-4gal');
    expect(equipment[0].state.calibratedGpa).toBeUndefined();

    await sprayerSheet.getByLabel('Fluid ounces in the jug').fill('20');
    await sprayerSheet.getByRole('button', { name: 'Save to Old Blue' }).click();
    await expect(sprayerSheet).toBeHidden();
    await expect(page).toHaveURL(/\/spray$/);
    await expect(page.getByRole('button', { name: /Old Blue/ })).toContainText(/20/);

    await page.getByRole('button', { name: /Atrazine 4L \(generic\)/ }).click();
    await expect(page.getByRole('heading', { name: /Spray Card/ })).toBeVisible({
      timeout: 15_000
    });
    await page.getByRole('button', { name: 'Confirm — record this spray' }).click();
    await expect(page.getByText(/Spray event recorded/)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/spray$/);
  });

  test('spray: an uncalibrated sprayer can be calibrated from the product step', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    const field = await page.request.post('/api/blocks', {
      data: { name: 'South 5' },
      headers: { origin: baseOrigin(page) }
    });
    const { block } = (await field.json()) as { block: { id: string } };
    await page.request.post(`/api/blocks/${block.id}/plantings`, {
      data: { cropPluginId: 'corn-sweet-bodacious', plantingDate: Date.now() - 86_400_000 },
      headers: { origin: baseOrigin(page) }
    });
    await page.request.post('/api/equipment', {
      data: { type: 'sprayer', label: 'Pull 50' },
      headers: { origin: baseOrigin(page) }
    });

    await page.goto('/spray');
    await page.waitForLoadState('networkidle');
    const hint = page.getByTestId('uncalibrated-hint');
    await hint.getByRole('button', { name: 'Calibrate Pull 50' }).click();
    const calib = sheet(page, 'Calibrate Pull 50');
    await calib.getByLabel('Fluid ounces in the jug').fill('15');
    await calib.getByRole('button', { name: 'Save to Pull 50' }).click();
    await expect(calib).toBeHidden();
    await expect(page.getByTestId('uncalibrated-hint')).toHaveCount(0);
  });

  test('insecticide and fungicide: name a spot in place', async ({ page }) => {
    for (const path of ['/spray/insecticide', '/spray/fungicide']) {
      await provisionEmptyFarm(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const where = page.getByTestId('spray-where');
      await expect(where.getByRole('heading', { name: 'Where are you spraying?' })).toBeVisible();
      await where.getByRole('button', { name: 'Name a new spot' }).click();
      const dialog = sheet(page, 'Where?');
      const name = path.endsWith('insecticide') ? 'Squash patch' : 'Vineyard row';
      await nameSpot(page, dialog, name, /^Garden/);
      await dialog.getByRole('button', { name: 'Save this spot' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId('spray-where')).toHaveCount(0);
      await expect(page.locator('select[id$="-block"] option:checked')).toHaveText(name);
    }
  });

  test('scout: a farm with no blocks gets a "Where?" card', async ({ page }) => {
    await provisionEmptyFarm(page);
    await page.goto('/scout');
    await page.waitForLoadState('networkidle');
    const where = page.getByTestId('scout-where');
    await expect(where.getByRole('heading', { name: 'Where are you scouting?' })).toBeVisible();
    await where.getByRole('button', { name: 'Name a new spot' }).click();
    const dialog = sheet(page, 'Where?');
    await nameSpot(page, dialog, 'Back pasture', /^Pasture/);
    await dialog.getByRole('button', { name: 'Save this spot' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel('Which block are you scouting?')).toHaveValue(/.+/);
    await expect(page.locator('#scout-block option:checked')).toHaveText('Back pasture');
  });

  test('harvest: record a pick for something never planned', async ({ page }) => {
    await provisionEmptyFarm(page);
    await page.goto('/harvest');
    await page.waitForLoadState('networkidle');
    const what = page.getByTestId('harvest-what');
    await expect(what.getByRole('heading', { name: 'What are you picking?' })).toBeVisible();
    await what.getByRole('button', { name: "Add what you're picking" }).click();

    const dialog = sheet(page, 'What are you picking?');
    await nameSpot(page, dialog, 'Kitchen beds', /^Garden/);
    await dialog.getByRole('button', { name: 'Save and continue' }).click();
    await dialog.getByLabel('What is it?').fill('Buttercrunch');
    await dialog
      .getByRole('button', { name: /Buttercrunch/ })
      .first()
      .click();
    const months = dialog.getByLabel('Planted around');
    const secondMonth = await months.locator('option').nth(2).getAttribute('value');
    await months.selectOption(secondMonth!);
    await expect(dialog.getByLabel('Planting date')).toHaveValue(`${secondMonth}-15`);
    await dialog.getByRole('button', { name: 'Save and record the harvest' }).click();
    await expect(dialog).toBeHidden();

    const planting = page.locator('li.planting', { hasText: 'Kitchen beds' });
    await expect(planting).toBeVisible();
    await expect(planting.locator('.renderer-mount')).toBeVisible();
    await expect(page).toHaveURL(/\/harvest$/);
  });

  test('plan: an empty farm asks "Where will this grow?" instead of redirecting', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    await page.goto('/plan');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/plan$/);
    const where = page.getByTestId('plan-where');
    await expect(where.getByRole('heading', { name: 'Where will this grow?' })).toBeVisible();
    await expect(page.locator('.aw-modal')).toHaveCount(0);

    await where.getByRole('link', { name: /Sketch it by size/ }).click();
    await expect(page).toHaveURL(/\/plan\/farm\?mode=sketch$/);
    await expect(page.getByRole('button', { name: /Dimensions/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await page.goto('/plan');
    await page
      .getByTestId('plan-where')
      .getByRole('link', { name: /Draw it on the map/ })
      .click();
    await expect(page).toHaveURL(/\/plan\/farm$/);

    await page.goto('/plan');
    await page
      .getByTestId('plan-where')
      .getByRole('button', { name: /Just give it a name/ })
      .click();
    const dialog = sheet(page, 'Just give it a name');
    await nameSpot(page, dialog, 'Salad bed', /^Garden/);
    await dialog.getByRole('button', { name: 'Save this spot' }).click();
    await expect(page).toHaveURL(/\/plan\?block=/);
    await expect(page.getByTestId('plan-where')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Salad bed' }).first()).toBeVisible();
  });

  test('inventory: an empty list offers the five kinds in the same chrome', async ({ page }) => {
    await provisionEmptyFarm(page);
    await page.goto('/inventory?type=pesticide');
    await page.waitForLoadState('networkidle');
    const empty = page.getByTestId('inventory-empty');
    await expect(empty.getByRole('heading', { name: 'No pesticides yet' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Inventory type' })).toBeVisible();
    await expect(empty.getByRole('link')).toHaveCount(5);
    await empty.getByRole('link', { name: /Seeds/ }).click();
    await expect(page).toHaveURL(/\/inventory\/seed\/add$/);
  });

  test('helpers are asked to go to the owner instead of seeing setup sheets', async ({
    page,
    browser
  }) => {
    await provisionEmptyFarm(page);
    const helper = await provisionHelper(page, browser);

    await helper.goto('/spray');
    await expect(helper.getByTestId('spray-where').getByRole('note')).toContainText(
      'Ask the owner'
    );
    await expect(helper.getByRole('button', { name: "Add what's growing" })).toHaveCount(0);

    await helper.goto('/scout');
    await expect(helper.getByTestId('scout-where').getByRole('note')).toContainText(
      'Ask the owner'
    );

    await helper.goto('/harvest');
    await expect(helper.getByTestId('harvest-what').getByRole('note')).toContainText(
      'Ask the owner'
    );

    await helper.goto('/spray/fungicide');
    await expect(helper.getByTestId('spray-where').getByRole('note')).toContainText(
      'Ask the owner'
    );

    await helper.goto('/inventory?type=sprayer');
    const empty = helper.getByTestId('inventory-empty');
    await expect(empty.getByRole('note')).toContainText('Ask the owner');
    await expect(empty.getByRole('link')).toHaveCount(0);

    const forged = await helper.request.post('/api/blocks', {
      data: { name: 'Sneaky' },
      headers: { origin: baseOrigin(helper) }
    });
    expect(forged.status()).toBe(403);

    await helper.context().close();
  });
});

function baseOrigin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}
