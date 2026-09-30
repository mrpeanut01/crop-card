import type { Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { provisionWizardTenant } from './lib/wizardTenant';

// Phase 32E season extension (E2). No Anthropic key in e2e, so the planting
// window is the deterministic frost-date window throughout.

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayOf(label: string, year: number): number {
  const [mon, day] = label.trim().split(/\s+/);
  return Date.UTC(year, MONTHS.indexOf(mon), Number(day));
}

async function earliestLabel(page: Page): Promise<string> {
  const chip = page
    .getByRole('dialog', { name: 'Add planting' })
    .getByRole('group', { name: 'Suggested planting dates' })
    .getByRole('button', { name: /Earliest/ });
  return (await chip.locator('.chip-v').textContent())!.trim();
}

async function openAddPlanting(page: Page) {
  await page.goto('/plan?tab=overview');
  await page.waitForLoadState('networkidle');
  await page
    .getByRole('button', { name: /Add planting/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add planting' });
  await dialog.getByRole('combobox', { name: 'Crop' }).fill('Celebrity');
  await dialog
    .getByRole('listbox')
    .getByRole('option', { name: /Tomato Celebrity/ })
    .first()
    .click();
  await expect(dialog.getByRole('group', { name: 'Suggested planting dates' })).toBeVisible();
  return dialog;
}

test.describe('season extension (Phase 32E)', () => {
  test('adding a low tunnel moves the planting window earlier', async ({ page }) => {
    const tenant = await provisionWizardTenant(page, { seeds: [] });
    const dialog = await openAddPlanting(page);
    const seasonYear = Number(
      (await dialog.locator('#np-date').getAttribute('data-season-year')) ?? tenant.year
    );
    const before = await earliestLabel(page);

    await dialog.locator('#np-date').fill(`${seasonYear}-01-10`);
    await expect(
      dialog.getByText("That's before the earliest date, so expect frost or cold-soil risk.")
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Too early for this bed. Add a cover?' }).click();

    const sheet = page.getByRole('dialog', { name: 'Add a cover' });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByText("Cover shift not known. Enter the days from your cover's instructions.")
    ).toBeVisible();
    await sheet.getByLabel('Kind of cover').selectOption('low-tunnel');
    await sheet.getByLabel('Spring: days earlier').fill('21');
    await sheet.getByLabel('Fall: days later').fill('14');
    const saved = page.waitForResponse(
      (r) => /\/api\/blocks\/[^/]+\/protections/.test(r.url()) && r.request().method() === 'POST'
    );
    await sheet.getByRole('button', { name: 'Add cover' }).click();
    expect((await saved).status()).toBe(201);
    await expect(sheet).toBeHidden();

    await expect.poll(() => earliestLabel(page)).not.toBe(before);
    const after = await earliestLabel(page);
    expect((dayOf(before, seasonYear) - dayOf(after, seasonYear)) / 86_400_000).toBe(21);
    await expect(dialog.getByTestId('np-bed-frost')).toContainText('Covered: frost ends');

    const covers = await page.request.get(
      `/api/blocks/${tenant.blocks[0].id}/protections?year=${seasonYear}`
    );
    const body = (await covers.json()) as {
      protections: Array<{ kind: string; springShiftDays: number; provenance: string }>;
    };
    expect(body.protections).toEqual([
      expect.objectContaining({ kind: 'low-tunnel', springShiftDays: 21, provenance: 'manual' })
    ]);
  });

  test('Edit block lists the cover and the owner can remove it', async ({ page }) => {
    const tenant = await provisionWizardTenant(page, { seeds: [] });
    const blockId = tenant.blocks[0].id;
    const add = await page.request.post(`/api/blocks/${blockId}/protections`, {
      data: { kind: 'row-cover', springShiftDays: 7, fallShiftDays: 10 },
      headers: { origin: origin(page) }
    });
    expect(add.status()).toBe(201);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/plan?tab=overview&block=${blockId}`);
    await page.waitForLoadState('networkidle');
    await page
      .getByRole('button', { name: /Edit block/ })
      .first()
      .click();
    const modal = page.getByRole('dialog', { name: 'Edit block' });
    const chip = modal.getByTestId('cover-chip');
    await expect(chip).toContainText('Row cover');
    await expect(chip).toContainText('Spring 7 days earlier');
    await expect(chip).toContainText('Fall 10 days later');
    await expect(chip.locator('[data-provenance="manual"]')).toBeVisible();
    await expect(
      modal.getByText("Covers buy a few degrees. They don't stop a hard freeze.")
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const remove = modal.getByRole('button', { name: 'Remove Row cover' });
    const box = (await remove.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    await remove.click();
    await expect(modal.getByTestId('cover-chip')).toHaveCount(0);
    await expect(modal.getByText('No covers on this bed.')).toBeVisible();
  });

  test('the designer bed inspector shows cover chips on a phone', async ({ page }) => {
    await provisionWizardTenant(page, { blocks: [], seeds: [] });
    const area = await page.request.post('/api/fields', {
      data: { name: 'Kitchen garden', kind: 'garden', widthFt: 20, lengthFt: 20 },
      headers: { origin: origin(page) }
    });
    expect(area.ok()).toBe(true);
    const areaJson = (await area.json()) as { field?: { id: string }; id?: string };
    const areaId = areaJson.field?.id ?? areaJson.id!;
    const bed = await page.request.post('/api/blocks', {
      data: {
        name: 'Bed 3',
        fieldId: areaId,
        kind: 'bed',
        widthFt: 4,
        lengthFt: 8,
        xFt: 2,
        yFt: 2
      },
      headers: { origin: origin(page) }
    });
    expect(bed.ok(), await bed.text()).toBe(true);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/plan/areas/${areaId}/design?view=list`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('garden-designer')).toHaveAttribute('data-ready', 'true');
    const row = page.locator('[data-testid="list-bed"][data-bed-name="Bed 3"]');
    await row.getByRole('button', { name: /^Bed 3/ }).click();
    const sheet = row.getByTestId('bed-sheet');
    await expect(sheet.getByText('No covers on this bed.')).toBeVisible();
    await sheet.getByRole('button', { name: '+ Add a cover' }).click();

    const add = page.getByRole('dialog', { name: 'Add a cover' });
    await add.getByLabel('Kind of cover').selectOption('high-tunnel');
    await add.getByLabel('Spring: days earlier').fill('30');
    await add.getByRole('button', { name: 'Add cover' }).click();
    await expect(add).toBeHidden();

    await expect(sheet.getByTestId('cover-chip')).toContainText('High tunnel');
    await expect(sheet.getByTestId('bed-frost-summary')).toContainText('Covered: frost ends');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
