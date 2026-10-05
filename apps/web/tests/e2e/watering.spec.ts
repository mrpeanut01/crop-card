import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

// Phase 32E (E4): rain-aware watering on /today.

const DAY = 86_400_000;
const H = 3_600_000;
/** Lynchburg (KLYH) is the only weather station, about 25 miles away. */
const FAR_FROM_STATION: [number, number] = [37.6, -79.5];

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function kitchenGarden(page: Page, latLon?: [number, number]) {
  await signInNewUser(page, 'water');
  await createOnboardedFarm(page, { growing: ['garden'], latLon });
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Kitchen beds',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 20
  });
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Bed 1',
    kind: 'bed',
    widthFt: 4,
    lengthFt: 10,
    fieldId: field.id
  });
  await post(page, `/api/blocks/${block.id}/plantings`, {
    cropPluginId: 'tomato-cherokee-purple',
    plantingDate: Date.now() - 10 * DAY
  });
  return { fieldId: field.id, bedId: block.id };
}

async function openToday(page: Page) {
  await page.goto('/today');
  await page.waitForLoadState('networkidle');
}

test.describe('watering advice', () => {
  test.describe.configure({ timeout: 120_000 });

  test('shows rain unknown when the only station is 25 miles away', async ({ page }) => {
    await kitchenGarden(page, FAR_FROM_STATION);
    await openToday(page);
    const card = page.locator('[data-testid="advice-card"][data-kind="watering"]');
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading')).toHaveText('Kitchen beds: rain unknown here');
    await expect(card).toContainText('Rain unknown here, check your gauge.');
    await expect(card).toContainText(
      /Lynchburg Rgnl AP \(KLYH\), 2\d(\.\d)? mi away, too far to count/
    );
    await expect(card).toContainText('Target 1 in a week');
    await expect(card).not.toContainText(/spray/i);
  });

  test('a gauge reading after a storm turns the card into skip watering', async ({ page }) => {
    const g = await kitchenGarden(page);
    // Last week's empty gauge, so tonight's reading covers the whole week.
    await post(page, '/api/rain-gauge', {
      fieldIds: [g.fieldId],
      inches: 0,
      readAt: Date.now() - 167 * H
    });
    await openToday(page);
    const card = page.locator('[data-testid="advice-card"][data-kind="watering"]');
    await card.getByRole('button', { name: 'Enter rain gauge' }).click();
    const sheet = page.getByTestId('rain-gauge-form');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('gauge-counts-from')).toContainText('your last reading');
    await sheet.getByLabel('Inches in the gauge').fill('1.3');
    await sheet.getByRole('button', { name: 'Save gauge reading' }).click();
    await expect(page.getByText('Gauge reading saved.')).toBeVisible();
    await expect(card.getByRole('heading')).toHaveText('Skip watering the Kitchen beds today');
    await expect(card).toContainText('Rain from your gauge');
  });

  test('logging watering shows on /records behind the Watering chip', async ({ page }) => {
    await kitchenGarden(page, FAR_FROM_STATION);
    await openToday(page);
    const card = page.locator('[data-testid="advice-card"][data-kind="watering"]');
    await card.getByRole('button', { name: 'Log watering' }).click();
    const form = page.getByTestId('log-watering-form');
    await expect(form).toBeVisible();
    await form.getByLabel('Where').selectOption({ label: 'Bed 1' });
    await form.getByLabel('Inches of water').fill('0.5');
    await form.getByRole('button', { name: 'Save watering' }).click();
    await expect(page.getByText('Watering saved.')).toBeVisible();

    await page.goto('/records');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('watering-log')).toHaveCount(0);
    await page.getByTestId('watering-chip').click();
    await page.waitForLoadState('networkidle');
    const log = page.getByTestId('watering-log');
    await expect(log).toContainText('Kitchen beds · Bed 1');
    await expect(log).toContainText('0.5 in');
    await log.getByRole('button', { name: 'Card' }).click();
    await expect(page.getByTestId('record-card-panel')).toContainText('Watered Bed 1');
  });

  test('the watering card fits a 375px phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await kitchenGarden(page, FAR_FROM_STATION);
    await openToday(page);
    // Only the watering card: on a Monday the Monday summary card shows too.
    await expect(page.locator('[data-testid="advice-card"][data-kind="watering"]')).toHaveCount(1);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
    for (const name of ['Log watering', 'Enter rain gauge']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    }
  });
});
