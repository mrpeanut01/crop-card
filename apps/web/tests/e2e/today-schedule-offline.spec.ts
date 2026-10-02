import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

const DAY = 86_400_000;

async function cornFarm(page: Page, prefix: string) {
  await signInNewUser(page, prefix);
  await createOnboardedFarm(page, { growing: ['garden'] });
  const post = async <T>(url: string, data: Record<string, unknown>) => {
    const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
    expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const area = await post<{ field: { id: string } }>('/api/fields', {
    name: 'Corn patch',
    kind: 'garden',
    widthFt: 40,
    lengthFt: 40
  });
  const bed = await post<{ block: { id: string } }>('/api/blocks', {
    name: 'Corn rows',
    kind: 'bed',
    widthFt: 10,
    lengthFt: 20,
    fieldId: area.field.id
  });
  for (const days of [12, 16, 20, 24, 28, 32, 36]) {
    await post(`/api/blocks/${bed.block.id}/plantings`, {
      cropPluginId: 'corn',
      plantingDate: Date.now() - days * DAY
    });
  }
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

const blockTaskPosts = (page: Page) =>
  page.route('**/api/tasks', (route) =>
    route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback()
  );

test.describe('scheduling a suggestion with no signal (34A SO-11)', () => {
  test('the pending card shows at once, survives a reload and becomes the real task', async ({
    page,
    context
  }) => {
    await cornFarm(page, 'schedoff');
    await open(page, '/today');
    const buttons = page.getByRole('button', { name: /^Schedule: / });
    expect(await buttons.count()).toBeGreaterThan(0);
    const name = (await buttons.first().getAttribute('aria-label'))!;
    const title = name.replace(/^Schedule: /, '');
    const same = page.getByRole('button', { name, exact: true });
    const before = await same.count();

    await context.setOffline(true);
    await page.getByRole('button', { name, exact: true }).first().click();
    await expect(page.getByText('Added. It will save when you have signal.')).toBeAttached();

    const pending = page.getByTestId('pending-schedule').filter({ hasText: title });
    await expect(pending).toHaveCount(1);
    await expect(pending).toContainText('Will save when online');
    await expect(pending).toContainText('Corn rows');
    await expect(pending.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('button', { name, exact: true }).first()).toBeDisabled();
    await expect(page.locator('.deck-card', { hasText: title })).toHaveCount(0);

    // Back on the network but the save still cannot get through, so the row
    // stays on the phone across a reload.
    await blockTaskPosts(page);
    await context.setOffline(false);
    await open(page, '/today');
    await expect(page.getByTestId('pending-schedule').filter({ hasText: title })).toHaveCount(1);

    await page.unroute('**/api/tasks');
    await open(page, '/today');
    await expect(page.getByTestId('pending-schedule')).toHaveCount(0, { timeout: 15_000 });
    const card = page.locator('.deck-card', { hasText: title });
    await expect(card).toHaveCount(1, { timeout: 15_000 });
    await expect(card).toContainText('Due today');
    await expect(same).toHaveCount(before - 1);

    const tasks = await page.request.get('/api/tasks?limit=1000');
    const list = (
      (await tasks.json()) as { tasks: { title: string; pluginTemplateKey?: string }[] }
    ).tasks;
    expect(
      list.filter((t) => t.title === title && t.pluginTemplateKey?.startsWith('derived:'))
    ).toHaveLength(1);
  });

  test('in Week the suggestion stays on its day with the badge and Schedule turned off', async ({
    page,
    context
  }) => {
    await cornFarm(page, 'schedwk');
    await open(page, '/today?view=week');
    const chip = page
      .locator('[data-testid="calendar-week"] .chip[data-chip="suggestion"]')
      .first();
    await expect(chip).toBeVisible();
    await chip.click();
    const sheet = page.getByTestId('today-sheet');
    const schedule = sheet.getByRole('button', { name: /^Schedule:/ }).first();
    const name = (await schedule.getAttribute('aria-label'))!;

    await context.setOffline(true);
    await schedule.click();
    await expect(sheet).toBeHidden();
    await blockTaskPosts(page);
    await context.setOffline(false);

    await chip.click();
    const again = page.getByTestId('today-sheet').getByRole('button', { name, exact: true });
    await expect(again).toBeDisabled();
    await expect(
      page.getByTestId('today-sheet').locator('[data-queued-schedule]').first()
    ).toContainText('Will save when online');
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(chip).toHaveAttribute('aria-label', /waiting to upload/);
  });
});
