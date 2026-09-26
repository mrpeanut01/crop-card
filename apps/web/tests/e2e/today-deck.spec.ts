import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';
import { provisionHelper } from './lib/freshFarm';

const DAY = 86_400_000;

async function addTask(
  page: Page,
  body: { title: string; scheduledFor: number; kind?: string; linkedToTaskId?: string }
): Promise<string> {
  const res = await page.request.post('/api/tasks', {
    data: { kind: 'primary', ...body },
    headers: { origin: originOf(page) }
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { task: { id: string } }).task.id;
}

async function farmWithTasks(page: Page, prefix: string) {
  await signInNewUser(page, prefix);
  await createOnboardedFarm(page, { growing: ['garden'] });
  const now = Date.now();
  const late = await addTask(page, {
    title: 'Pull the bolted lettuce',
    scheduledFor: now - 2 * DAY
  });
  const today = await addTask(page, { title: 'Stake the tomatoes', scheduledFor: now });
  await addTask(page, {
    title: 'Find the twine',
    scheduledFor: now,
    kind: 'pre-task',
    linkedToTaskId: today
  });
  const planned = await addTask(page, { title: 'Sow fall peas', scheduledFor: now + 3 * DAY });
  return { late, today, planned };
}

function card(page: Page, id: string) {
  return page.locator(`[data-testid="today-deck"] .deck-card[data-task-id="${id}"]`);
}

test.describe('/today task deck', () => {
  test('the day renders as task cards with derived status, filters and actions', async ({
    page
  }) => {
    const ids = await farmWithTasks(page, 'deck');
    await page.goto('/today');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('details.legacy-detail')).toHaveCount(0);
    const deck = page.getByTestId('today-deck');
    await expect(deck.getByRole('heading', { name: "Today's work" })).toBeVisible();
    await expect(card(page, ids.late).locator('[data-card-status="late"]')).toHaveText('Late');
    await expect(card(page, ids.today).locator('[data-card-status="due-today"]')).toHaveText(
      'Due today'
    );
    await expect(card(page, ids.today)).toContainText('Find the twine');
    await expect(card(page, ids.planned)).toHaveCount(0);
    await expect(page.getByTestId('deck-summary')).toHaveText('1 late · 2 due today');

    await deck.getByRole('button', { name: 'Next 7 days' }).click();
    await expect(page).toHaveURL(/tab=7d/);
    await expect(card(page, ids.planned).locator('[data-card-status="planned"]')).toHaveText(
      'Planned'
    );

    await card(page, ids.today).getByRole('button', { name: 'Done: Stake the tomatoes' }).click();
    await expect(card(page, ids.today).locator('[data-card-status="done"]')).toHaveText('Done');

    await card(page, ids.late)
      .getByRole('button', { name: 'Skip: Pull the bolted lettuce' })
      .click();
    await card(page, ids.late).getByLabel('Why are you skipping this?').fill('Chickens got it');
    await card(page, ids.late).getByRole('button', { name: 'Save skip' }).click();
    await expect(card(page, ids.late).locator('[data-card-status="skipped"]')).toHaveText(
      'Skipped'
    );
    await expect(card(page, ids.late)).toContainText('Chickens got it');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('deck-summary')).toContainText('1 planned');
    await expect(page.getByTestId('deck-summary')).toContainText('1 done');
    await expect(page.getByTestId('deck-summary')).toContainText('1 skipped');

    await deck.getByRole('button', { name: 'Calendar' }).click();
    await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
    await expect(page.locator('.grid .item', { hasText: 'Sow fall peas' })).toBeVisible();
    await deck.getByRole('button', { name: 'Next 30 days' }).click();
    await expect(page.getByRole('heading', { name: 'Next 4 weeks' })).toBeVisible();
    await deck.getByRole('button', { name: 'Season' }).click();
    await expect(page.getByRole('heading', { name: 'This season' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Season by crop' })).toBeVisible();
    await page.getByRole('tab', { name: 'Week' }).click();
    await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();

    await expect(page.getByTestId('today-gear')).toContainText('Rules version');
  });

  test('a Done with no signal waits on the card and saves when back online', async ({
    page,
    context
  }) => {
    const ids = await farmWithTasks(page, 'deckoff');
    await page.goto('/today');
    await page.waitForLoadState('networkidle');

    await context.setOffline(true);
    await card(page, ids.today).getByRole('button', { name: 'Done: Stake the tomatoes' }).click();
    await expect(card(page, ids.today).getByText('Will save when online')).toBeVisible();
    await expect(card(page, ids.today).locator('[data-card-status="done"]')).toHaveText('Done');

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(card(page, ids.today).getByText('Will save when online')).toHaveCount(0, {
      timeout: 20_000
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(card(page, ids.today).locator('[data-card-status="done"]')).toHaveText('Done');
  });

  test('a helper sees the farm tasks and can finish them', async ({ page, browser }) => {
    const ids = await farmWithTasks(page, 'deckhelp');
    const helper = await provisionHelper(page, browser);
    await helper.goto('/today');
    await helper.waitForLoadState('networkidle');
    await expect(card(helper, ids.today)).toBeVisible();
    await expect(helper.getByTestId('getting-started')).toHaveCount(0);
    await card(helper, ids.today).getByRole('button', { name: 'Done: Stake the tomatoes' }).click();
    await expect(card(helper, ids.today).locator('[data-card-status="done"]')).toHaveText('Done');
    await helper.context().close();
  });

  test('at phone width the cards fit, with 48px controls', async ({ page }) => {
    const ids = await farmWithTasks(page, 'deckphone');
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await expect(card(page, ids.today)).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
    const controls = page.locator(
      '[data-testid="today-deck"] .chip, [data-testid="today-deck"] .deck-card button'
    );
    for (const box of await controls.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect())
    )) {
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
  });
});
