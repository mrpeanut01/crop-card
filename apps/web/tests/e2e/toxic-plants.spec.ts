import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 32D (D5): the toxic-plant advisory. One collapsed line that opens
// to the list, below the hold chips, on the Animal and group pages, the
// Area Card and the move sheet's destination. Advisory only; it never
// blocks and cannot be dismissed.

const PHONE = { width: 375, height: 800 };
const DAY = 86_400_000;

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function areaWithCrop(page: Page, name: string, kind: string, cropPluginId: string) {
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', { name, kind });
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: `${name} bed`,
    fieldId: field.id
  });
  await post(page, `/api/blocks/${block.id}/plantings`, {
    cropPluginId,
    plantingDate: Date.now() - 7 * DAY
  });
  return field.id;
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

test.describe('toxic-plant advisory', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a dog living by the tomatoes sees one collapsed line, and the move sheet warns about the grapes', async ({
    page
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const yard = await areaWithCrop(page, 'Back yard', 'garden', 'tomato-roma-vf');
    await areaWithCrop(page, 'Side yard', 'garden', 'grape-concord');
    const { animal } = await post<{ animal: { id: string } }>(page, '/api/animals', {
      speciesId: 'dog',
      name: 'Biscuit',
      housingFieldId: yard
    });

    await open(page, `/animals/${animal.id}`);
    const callout = page.getByTestId('toxic-plants');
    await expect(callout).toHaveCount(1);
    const summary = callout.locator('summary');
    await expect(summary).toHaveText(/1 plant here can harm dogs/);
    const box = await summary.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await expect(callout.getByText(/Leaves, stems and unripe fruit/)).toBeHidden();
    await summary.click();
    await expect(callout.getByText(/Leaves, stems and unripe fruit/)).toBeVisible();
    await expect(callout).toContainText('call your vet');
    await expect(callout.getByRole('button')).toHaveCount(0);
    await noHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Move', exact: true }).click();
    const form = page.getByRole('form', { name: 'Move' });
    await form.getByLabel('Move to').selectOption({ label: 'Side yard (Garden)' });
    const moveNote = form.getByTestId('toxic-plants');
    await expect(moveNote.locator('summary')).toHaveText(
      /At Side yard: 1 plant here can harm dogs/
    );
    await noHorizontalOverflow(page);
    await form.getByRole('button', { name: 'Save the move' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Moved to Side yard' })).toBeVisible();
  });

  test('goats on sorghum-sudangrass: the group page and the Area Card both show it', async ({
    page
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const lot = await areaWithCrop(page, 'Summer lot', 'pasture', 'bmr-sorghum-sudan');
    const { group } = await post<{ group: { id: string } }>(page, '/api/animal-groups', {
      name: 'Herd A',
      speciesId: 'goat',
      headCount: 6,
      housingFieldId: lot
    });

    await open(page, `/animals/groups/${group.id}`);
    await expect(page.getByTestId('toxic-plants').locator('summary')).toHaveText(
      /1 plant here can harm goats/
    );
    await noHorizontalOverflow(page);

    await open(page, `/plan?setup=skip&field=${lot}`);
    const area = page
      .getByTestId('plan-area-view')
      .locator('article[data-card-kind="area"][data-variant="screen"]');
    const fold = area.locator('details[data-collapsible-section]');
    await expect(fold.locator('summary')).toContainText('1 plant here can harm goats');
    await fold.locator('summary').click();
    await expect(fold).toContainText('prussic acid');
    await noHorizontalOverflow(page);
  });
});
