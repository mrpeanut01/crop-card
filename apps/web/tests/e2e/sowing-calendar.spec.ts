import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';
import { provisionHelper } from './lib/freshFarm';

const DAY = 86_400_000;

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

async function post<T>(page: Page, url: string, data: Record<string, unknown>): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

async function farmWithPlantings(page: Page, prefix: string) {
  await signInNewUser(page, prefix);
  await createOnboardedFarm(page, { growing: ['garden'] });
  const area = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Kitchen garden',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  const bed = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Bed 1',
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    fieldId: area.field.id
  });
  const dated = await post<{ planting: { id: string } }>(
    page,
    `/api/blocks/${bed.block.id}/plantings`,
    { cropPluginId: 'tomato-cherokee-purple', plantingDate: Date.now() - 5 * DAY }
  );
  const undated = await post<{ planting: { id: string } }>(
    page,
    `/api/blocks/${bed.block.id}/plantings`,
    { cropPluginId: 'tomato-cherokee-purple', varietyDisplayName: 'Later tomatoes' }
  );
  return { dated: dated.planting.id, undated: undated.planting.id };
}

test.describe('/plan/calendar sowing calendar', () => {
  test('shows each planting, frost lines, the short-day band and prints', async ({ page }) => {
    const ids = await farmWithPlantings(page, 'sowcal');
    await open(page, '/today?view=season');
    const link = page.getByTestId('season-print-calendar');
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/plan\/calendar\?year=\d{4}/);

    const cal = page.getByTestId('sowing-calendar');
    await expect(cal.getByRole('heading', { name: 'Sowing calendar' })).toBeVisible();
    await expect(cal.locator('[data-frost="last-spring"]')).toContainText('Last spring frost');
    await expect(cal.locator('[data-frost="first-fall"]')).toContainText('First fall frost');
    await expect(cal.getByTestId('daylight-note')).toContainText('under 10 hours of daylight');

    const dated = cal.locator(`tr[data-planting-id="${ids.dated}"]`);
    await expect(dated).toBeVisible();
    await expect(dated.locator('.bar[data-kind="direct-sow"]')).toHaveCount(1);
    await expect(dated.getByTestId('row-dates')).toContainText(/Direct sow \w+ \d+/);
    const undated = cal.locator(`tr[data-planting-id="${ids.undated}"]`);
    await expect(undated.locator('.bar[data-kind="window"]')).toHaveCount(1);
    await expect(undated.locator('.bar[data-kind="window"]')).toContainText('Window');

    await page.evaluate(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed++;
      };
    });
    await cal.getByRole('button', { name: 'Print' }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(
      1
    );

    await page.emulateMedia({ media: 'print' });
    const top = cal.getByTestId('print-top');
    await expect(top).toBeVisible();
    await expect(top).toContainText('Sowing calendar, Season');
    expect(
      await top.evaluate((el) => {
        const facts = el.parentElement?.querySelector('.facts');
        return !!facts && !!(el.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING);
      })
    ).toBe(true);
    await expect(cal.locator('thead .print-head')).toBeVisible();
    await expect(cal.getByRole('button', { name: 'Print' })).toBeHidden();
    await expect(page.locator('nav').first()).toBeHidden();
    await expect(dated.getByTestId('row-dates')).toBeVisible();
    await expect(dated.getByTestId('row-dates')).toContainText('Direct sow');
    await page.emulateMedia({ media: 'screen' });
  });

  test('the Plan workflow strip links to it and old grid bookmarks still redirect', async ({
    page
  }) => {
    await farmWithPlantings(page, 'sowcalplan');
    await open(page, '/plan');
    const link = page.getByRole('link', { name: 'Sowing calendar' });
    await expect(link).toHaveAttribute('href', /\/plan\/calendar\?year=\d{4}/);
    await link.click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('sowing-calendar')).toBeVisible();
    const res = await page.request.get('/plan/calendar?view=month', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toMatch(/^\/plan\?.*tab=calendar/);
  });

  test('a helper can read it', async ({ page, browser }) => {
    const ids = await farmWithPlantings(page, 'sowcalhelper');
    const helper = await provisionHelper(page, browser);
    await open(helper, '/plan/calendar');
    await expect(
      helper.getByTestId('sowing-calendar').locator(`tr[data-planting-id="${ids.dated}"]`)
    ).toBeVisible();
  });

  test('stays inside 375px and scrolls in its own frame', async ({ page }) => {
    const ids = await farmWithPlantings(page, 'sowcalnarrow');
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page, '/plan/calendar');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375
    );
    const frame = page.getByTestId('sowing-calendar').locator('.frame');
    expect(await frame.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    const row = page.locator(`tr[data-planting-id="${ids.dated}"]`);
    await expect(row.getByTestId('row-dates')).toBeVisible();
    await expect(row.getByTestId('row-dates')).toContainText('Direct sow');
    await frame.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    expect(await frame.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const frameBox = (await frame.boundingBox())!;
    const labelBox = (await row.locator('th.label').boundingBox())!;
    expect(labelBox.x).toBeGreaterThanOrEqual(frameBox.x - 1);
    expect(labelBox.x).toBeLessThan(frameBox.x + 10);
  });
});
