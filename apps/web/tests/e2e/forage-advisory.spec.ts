import type { Locator, Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 33C (cluster C4): the prussic acid and nitrate advisory and forage
// tests. Advisory only: it never blocks a move or a cutting, it shows for
// pets too, and the only numbers it carries are quoted from a named source.
// The lab rating the owner types is what the cards show.

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

async function fitsPhone(el: Locator) {
  const box = await el.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(PHONE.width);
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function areaWithCrop(page: Page, name: string, kind: string, cropPluginId: string) {
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', { name, kind });
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: `${name} strip`,
    fieldId: field.id
  });
  await post(page, `/api/blocks/${block.id}/plantings`, {
    cropPluginId,
    plantingDate: Date.now() - 20 * DAY
  });
  return { fieldId: field.id, blockId: block.id };
}

/** Text that is not one of the quoted source lines carries no digits,
 *  apart from dates. */
async function expectNoUnsourcedNumbers(el: Locator) {
  const lines = await el.locator('li, h4, p').allInnerTexts();
  for (const line of lines) {
    if (/^(Virginia Tech|Kansas State):/.test(line)) continue;
    if (/^(A reading|A frost alert|Nitrogen was|Sampled|Lab rating)/.test(line)) continue;
    expect(line, line).not.toMatch(/\d/);
  }
}

test.describe('forage advisory', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a dog headed for sudangrass sees the advisory on the move sheet, and the move still saves', async ({
    page
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const yard = await areaWithCrop(page, 'Back yard', 'garden', 'tomato-roma-vf');
    await areaWithCrop(page, 'Summer lot', 'pasture', 'sudangrass-piper');
    const { animal } = await post<{ animal: { id: string } }>(page, '/api/animals', {
      speciesId: 'dog',
      name: 'Biscuit',
      housingFieldId: yard.fieldId
    });

    await open(page, `/animals/${animal.id}`);
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    const form = page.getByRole('form', { name: 'Move' });
    await form.getByLabel('Move to').selectOption({ label: 'Summer lot (Pasture)' });
    const callout = form.getByTestId('forage-callout');
    const summary = callout.getByTestId('forage-advisory').locator('summary');
    await expect(summary).toHaveText(/At Summer lot: Forage check: prussic acid/, {
      timeout: 15_000
    });
    expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await summary.click();
    const advisory = callout.getByTestId('forage-advisory');
    await expect(advisory).toContainText('can form prussic acid (cyanide)');
    await expect(advisory).toContainText(
      'Virginia Tech: do not graze until plants reach 20 to 30 inches.'
    );
    await expect(advisory).not.toContainText(/\bsafe\b|\bclear\b/i);
    await expectNoUnsourcedNumbers(advisory);
    await expect(advisory.getByRole('button')).toHaveCount(0);
    await noHorizontalOverflow(page);

    await form.getByRole('button', { name: 'Save the move' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Moved to Summer lot' })).toBeVisible();
  });

  test('a helper records a forage test from the Area Card and the owner sees the typed lab rating', async ({
    page,
    browser
  }) => {
    await provisionEmptyFarm(page);
    const lot = await areaWithCrop(page, 'Sudan field', 'field', 'sudangrass-piper');

    const helper = await provisionHelper(page, browser);
    await helper.setViewportSize(PHONE);
    await open(helper, `/plan?setup=skip&field=${lot.fieldId}`);
    const area = helper
      .getByTestId('plan-area-view')
      .locator('article[data-card-kind="area"][data-variant="screen"]');
    await expect(area).toContainText('Forage check', { timeout: 15_000 });
    await area.getByRole('link', { name: 'Record a forage test' }).click();
    await helper.waitForLoadState('networkidle');
    await expect(helper).toHaveURL(new RegExp(`/forage\\?fieldId=${lot.fieldId}`));
    await noHorizontalOverflow(helper);

    const form = helper.getByTestId('forage-test-form');
    await expect(form.getByText('Lab report')).toHaveCount(0);
    await form.getByLabel('Lab', { exact: false }).first().fill('Dairy One');
    await form.getByLabel('Value', { exact: true }).fill('1500');
    await form.getByLabel('Units').selectOption('ppm-nitrate');
    await form.getByLabel(/Lab rating for nitrate/).fill('Caution, limit feeding');
    await form.getByLabel('Basis the lab used').selectOption('dry-matter');
    const save = form.getByRole('button', { name: 'Save forage test' });
    expect((await save.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await save.click();
    await expect(
      helper.getByRole('status').filter({ hasText: 'Forage test saved.' })
    ).toBeVisible();
    const row = helper.getByTestId('forage-test-row').first();
    await expect(row).toContainText(
      'Lab rating (owner-entered): nitrate Caution, limit feeding (dry matter basis)'
    );
    await expect(row).toContainText('1,500 ppm nitrate (NO3), as typed.');
    await expect(row).toContainText('About 345 ppm nitrate-nitrogen (converted)');
    await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await noHorizontalOverflow(helper);
    await helper.context().close();

    await open(page, `/plan?setup=skip&field=${lot.fieldId}`);
    const ownerCard = page
      .getByTestId('plan-area-view')
      .locator('article[data-card-kind="area"][data-variant="screen"]');
    await expect(ownerCard).toContainText('Forage check', { timeout: 15_000 });
    const fold = ownerCard
      .locator('details[data-collapsible-section]')
      .filter({ hasText: 'Forage check' });
    await fold.locator('summary').click();
    await expect(fold).toContainText(
      'Lab rating (owner-entered): nitrate Caution, limit feeding (dry matter basis)'
    );
    await expect(fold).not.toContainText(/\bsafe\b|\bclear\b/i);
  });

  test('a hay cutting shows its forage test and the form fits a phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
      name: 'Hay field',
      kind: 'field'
    });
    const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: 'Alfalfa block',
      acres: 3,
      fieldId: field.id
    });
    const { cutting } = await post<{ cutting: { id: string; cuttingNumber: number } }>(
      page,
      '/api/hay/cuttings',
      { blockId: block.id, cropPluginId: 'alfalfa-vernema', mowAt: Date.now() - 3_600_000 }
    );
    await open(page, `/hay?block=${block.id}&year=${new Date().getFullYear()}`);
    await expect(page.getByText(`Cutting #${cutting.cuttingNumber}`)).toBeVisible();
    const section = page.getByTestId('hay-forage');
    const record = section.getByRole('button', { name: 'Record a forage test' });
    expect((await record.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await record.click();
    const form = section.getByTestId('forage-test-form');
    await fitsPhone(form);
    await expect(form.getByText('Lab report').first()).toBeVisible();
    await form.getByLabel('Value', { exact: true }).first().fill('0.5');
    await form.getByLabel('Units').selectOption('pct-kno3');
    await form.getByLabel(/Lab rating for nitrate/).fill('High');
    await form.getByRole('button', { name: 'Save forage test' }).click();
    await expect(section.getByText('Forage test saved.')).toBeVisible();
    const advisory = section.getByTestId('forage-advisory');
    await expect(advisory).toContainText('Lab rating (owner-entered): nitrate High');
    await expect(advisory).toContainText('Not converted');
    await expect(advisory).toContainText(
      'Virginia Tech: nitrates do not decrease over time in dry hay.'
    );
    await fitsPhone(section);
  });
});
