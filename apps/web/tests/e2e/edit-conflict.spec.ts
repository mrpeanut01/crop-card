import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';

// Phase 36 (U-01 to U-08): the owner edits a planting in the /plan modal
// while a helper changes the same planting from another phone. A stale edit
// is never saved silently: the owner sees both values and picks.

const DAY = 86_400_000;

function originOf(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function api(page: Page, method: 'GET' | 'POST' | 'PATCH', url: string, data?: unknown) {
  const res = await page.request.fetch(url, {
    method,
    data,
    headers: { origin: originOf(page) }
  });
  const text = await res.text();
  return {
    status: res.status(),
    body: (text ? JSON.parse(text) : {}) as Record<string, ReturnType<typeof JSON.parse>>
  };
}

async function seedPlanting(page: Page): Promise<string> {
  await provisionEmptyFarm(page);
  const field = await api(page, 'POST', '/api/fields', {
    name: 'North field',
    kind: 'field',
    widthFt: 100,
    lengthFt: 200
  });
  expect(field.status, JSON.stringify(field.body)).toBeLessThan(300);
  const block = await api(page, 'POST', '/api/blocks', {
    name: 'Block 1',
    widthFt: 20,
    lengthFt: 50,
    fieldId: field.body.field.id
  });
  expect(block.status, JSON.stringify(block.body)).toBeLessThan(300);
  const planting = await api(page, 'POST', `/api/blocks/${block.body.block.id}/plantings`, {
    cropPluginId: 'tomato-cherokee-purple',
    plantingDate: Date.now() - 5 * DAY
  });
  expect(planting.status, JSON.stringify(planting.body)).toBeLessThan(300);
  return (planting.body.planting?.id ?? planting.body.id) as string;
}

async function crop(page: Page, id: string) {
  const res = await api(page, 'GET', `/api/crops/${id}`);
  expect(res.status).toBe(200);
  return res.body.crop as { varietyDisplayName: string; quantityPlanted: number | null };
}

/** A helper on another phone changes the variety, as that phone saw it. */
async function helperRenames(helper: Page, id: string, from: string, to: string) {
  const res = await api(helper, 'PATCH', `/api/crops/${id}`, {
    action: 'edit-details',
    varietyDisplayName: to,
    base: { varietyDisplayName: from }
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function openEditModal(page: Page) {
  await page.goto('/plan?tab=schedule');
  await page.waitForLoadState('networkidle');
  const editor = page.locator('details#legacy-plan');
  if (!(await editor.evaluate((d) => (d as HTMLDetailsElement).open))) {
    await editor.locator('summary').first().click();
  }
  await editor.locator('.swimlane .bar').first().click();
  await editor
    .locator('.schedule-action-row')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const modal = page.getByRole('dialog', { name: 'Edit planting' });
  await expect(modal).toBeVisible();
  return modal;
}

function fieldInput(modal: ReturnType<Page['getByRole']>, label: string) {
  return modal.locator('label', { hasText: label }).locator('input').first();
}

test.describe('edit conflicts between two devices (UI)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('an edit saved offline that conflicts is resolved on /records/pending with Keep mine', async ({
    page,
    browser
  }) => {
    const id = await seedPlanting(page);
    const helper = await provisionHelper(page, browser);
    const original = (await crop(page, id)).varietyDisplayName;

    const modal = await openEditModal(page);
    await page.context().setOffline(true);
    await fieldInput(modal, 'Variety name').fill('Owner pick');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal.getByTestId('edit-queued')).toHaveText(
      'Saved on this phone. It will upload when you are back online.'
    );
    await modal.getByRole('button', { name: 'Close' }).last().click();

    await helperRenames(helper, id, original, 'Helper pick');

    await page.context().setOffline(false);
    await page.goto('/records/pending');
    await page.waitForLoadState('networkidle');
    const sync = page.getByRole('button', { name: /Sync now/ });
    if (await sync.isEnabled()) await sync.click();
    const conflict = page.getByTestId('edit-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('was not saved');
    await expect(conflict).toContainText('Variety name');
    await expect(conflict).toContainText('Owner pick');
    await expect(conflict).toContainText('Helper pick');
    await conflict.getByRole('button', { name: 'Keep mine' }).click();
    await expect(page.getByTestId('edit-conflict')).toHaveCount(0);
    await expect(page.getByText('Queue is empty.')).toBeVisible();

    expect((await crop(page, id)).varietyDisplayName).toBe('Owner pick');
    await helper.context().close();
  });

  test('an online race shows the choice in the modal and Keep theirs keeps the other change', async ({
    page,
    browser
  }) => {
    const id = await seedPlanting(page);
    const helper = await provisionHelper(page, browser);
    const original = (await crop(page, id)).varietyDisplayName;

    const modal = await openEditModal(page);
    await helperRenames(helper, id, original, 'Helper pick');
    await fieldInput(modal, 'Variety name').fill('Owner pick');
    await modal.getByRole('button', { name: 'Save' }).click();

    const conflict = modal.getByTestId('edit-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('Someone else changed this planting');
    await conflict.getByRole('button', { name: 'Keep theirs' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit planting' })).toHaveCount(0);
    expect((await crop(page, id)).varietyDisplayName).toBe('Helper pick');

    const reopened = await openEditModal(page);
    await expect(fieldInput(reopened, 'Variety name')).toHaveValue('Helper pick');
    await helper.context().close();
  });

  test('Choose for each keeps the other variety and saves my amount', async ({ page, browser }) => {
    const id = await seedPlanting(page);
    const helper = await provisionHelper(page, browser);
    const before = await crop(page, id);

    const modal = await openEditModal(page);
    await helperRenames(helper, id, before.varietyDisplayName, 'Helper pick');
    await fieldInput(modal, 'Variety name').fill('Owner pick');
    await fieldInput(modal, 'Quantity planted').fill('42');
    await modal.getByRole('button', { name: 'Save' }).click();

    const conflict = modal.getByTestId('edit-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict.locator('[data-field]')).toHaveCount(1);
    await expect(conflict.locator('[data-field="varietyDisplayName"]')).toBeVisible();
    await conflict.getByRole('button', { name: 'Choose for each' }).click();
    const save = conflict.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await conflict.getByRole('radio', { name: /^Now on the farm/ }).check();
    await save.click();
    await expect(page.getByRole('dialog', { name: 'Edit planting' })).toHaveCount(0);

    const after = await crop(page, id);
    expect(after.varietyDisplayName).toBe('Helper pick');
    expect(after.quantityPlanted).toBe(42);
    await helper.context().close();
  });

  test('a conflict on /records/pending fits a 375px phone with 48px buttons', async ({
    page,
    browser
  }) => {
    const id = await seedPlanting(page);
    const helper = await provisionHelper(page, browser);
    const original = (await crop(page, id)).varietyDisplayName;
    await page.setViewportSize({ width: 375, height: 800 });

    const modal = await openEditModal(page);
    await page.context().setOffline(true);
    await fieldInput(modal, 'Variety name').fill(
      'A much longer owner variety name for a narrow phone'
    );
    await fieldInput(modal, 'Quantity planted').fill('7');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal.getByTestId('edit-queued')).toBeVisible();
    await helperRenames(helper, id, original, 'Helper pick');
    await api(helper, 'PATCH', `/api/crops/${id}`, {
      action: 'edit-details',
      quantityPlanted: 3,
      base: { quantityPlanted: (await crop(helper, id)).quantityPlanted }
    });
    await page.context().setOffline(false);

    await page.goto('/records/pending');
    await page.waitForLoadState('networkidle');
    const sync = page.getByRole('button', { name: /Sync now/ });
    if (await sync.isEnabled()) await sync.click();
    const conflict = page.getByTestId('edit-conflict');
    await expect(conflict).toBeVisible();
    await conflict.getByRole('button', { name: 'Choose for each' }).click();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const b of await conflict.locator('button, label.side').all()) {
      const box = await b.boundingBox();
      expect(box && box.height).toBeGreaterThanOrEqual(48);
    }
    await helper.context().close();
  });
});
