import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

// Phase 37E: an automatic waterer on a timer counts as water given, and a
// skipped run drops off the /today watering card.

const DAY = 86_400_000;
/** Lynchburg (KLYH) is the only weather station, about 25 miles away. */
const FAR_FROM_STATION: [number, number] = [37.6, -79.5];
const TIMER = 'Drip line on a hose timer';

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function herbGarden(page: Page) {
  await signInNewUser(page, 'waterer');
  await createOnboardedFarm(page, { growing: ['garden'], latLon: FAR_FROM_STATION });
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Herb beds',
    kind: 'garden',
    widthFt: 10,
    lengthFt: 10
  });
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Bed 1',
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    fieldId: field.id
  });
  await post(page, `/api/blocks/${block.id}/plantings`, {
    cropPluginId: 'basil-genovese',
    plantingDate: Date.now() - 10 * DAY
  });
}

test.describe('automatic waterer', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a drip timer with a schedule and targets shows on /today, and a skip moves it on', async ({
    page
  }) => {
    await herbGarden(page);

    await page.goto('/equipment');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('equip-template').selectOption('irrigation-drip-timer');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('link', { name: TIMER }).click();
    await page.waitForLoadState('networkidle');

    const editor = page.getByTestId('waterer-editor');
    await expect(editor).toContainText('No schedule yet.');
    await editor.getByTestId('waterer-edit').click();
    for (const day of ['Sunday', 'Tuesday', 'Thursday', 'Saturday']) {
      await editor.getByRole('button', { name: day }).click();
    }
    await editor.getByTestId('waterer-minutes').fill('20');
    await editor.getByTestId('waterer-inches').fill('0.4');
    await editor.getByTestId('waterer-save').click();
    await expect(editor.getByTestId('waterer-summary')).toContainText('Every day 6:00 for 20 min');

    await editor.getByLabel('All of Herb beds').check();
    await editor.getByTestId('waterer-targets-save').click();
    await expect(editor.getByTestId('waterer-targets')).toContainText('All of Herb beds');

    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    const card = page.locator('[data-testid="advice-card"][data-kind="watering"]');
    await expect(card).toHaveCount(1);
    const line = card.locator('p.line', { hasText: `${TIMER} gives 0.4 in` });
    await expect(line).toHaveCount(1);
    const before = (await line.textContent()) ?? '';

    const skip = card.getByTestId('advice-skip-run').filter({ hasText: `Skip ${TIMER}` });
    await expect(skip).toHaveCount(1);
    const box = await skip.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await skip.click();
    await expect(page.getByText("Skipped. That run won't count as water.")).toBeVisible();

    const after = card.locator('p.line', { hasText: `${TIMER} gives 0.4 in` });
    await expect(after).toHaveCount(1);
    await expect(after).not.toHaveText(before);
    await expect(card).not.toContainText(/spray/i);
  });
});
