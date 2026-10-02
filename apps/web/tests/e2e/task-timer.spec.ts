import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

const MIN = 60_000;

async function addTask(page: Page, title: string): Promise<string> {
  const res = await page.request.post('/api/tasks', {
    data: { kind: 'primary', title, scheduledFor: Date.now() },
    headers: { origin: originOf(page) }
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { task: { id: string } }).task.id;
}

async function savedMinutes(page: Page, taskId: string): Promise<number> {
  const res = await page.request.get(`/api/tasks/${taskId}/time`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { totalMinutes: number }).totalMinutes;
}

function deckCard(page: Page, id: string) {
  return page.locator(`[data-testid="today-deck"] .deck-card[data-task-id="${id}"]`);
}

/** The page's clock starts 30 minutes behind the server, so a timer moved
 *  forward 25 minutes still ends before the server's now (D-25). */
async function farmWithTask(page: Page, prefix: string, title: string) {
  await signInNewUser(page, prefix);
  await createOnboardedFarm(page, { growing: ['garden'] });
  const id = await addTask(page, title);
  await page.clock.install({ time: new Date(Date.now() - 30 * MIN) });
  await page.goto('/today');
  await page.waitForLoadState('networkidle');
  return id;
}

test.describe('task timer (33D, D2)', () => {
  test('start a timer, reload, stop, save and see the minutes on the task', async ({ page }) => {
    const id = await farmWithTask(page, 'timer', 'Stake the tomatoes');
    const card = deckCard(page, id);
    await card.getByRole('button', { name: 'Start timer: Stake the tomatoes' }).click();
    await expect(
      card.getByRole('button', { name: 'Stop timer: Stake the tomatoes' })
    ).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    const stop = card.getByRole('button', { name: 'Stop timer: Stake the tomatoes' });
    await expect(stop).toBeVisible();

    await page.clock.fastForward('25:00');
    await expect(card.getByTestId('timer-clock')).toHaveText('0:25');
    await stop.click();
    const sheet = page.getByTestId('timer-stop-sheet');
    await expect(sheet).toContainText('25 min');
    await sheet.getByRole('button', { name: 'Save time' }).click();
    await expect(card.getByTestId('timer-status')).toHaveText('Saved 25 min.');
    await expect(
      card.getByRole('button', { name: 'Start timer: Stake the tomatoes' })
    ).toBeVisible();

    await card.getByRole('button', { name: 'Time on this task' }).click();
    await expect(card.getByTestId('task-time-total')).toHaveText('25 min saved on this task.');
    expect(await savedMinutes(page, id)).toBe(25);

    await card.getByRole('button', { name: 'Remove 25 min' }).click();
    await expect(card.getByTestId('task-time-total')).toHaveText('No time saved on this task yet.');
  });

  test('Stop then Done closes the task with the timer minutes', async ({ page }) => {
    const id = await farmWithTask(page, 'timerdone', 'Weed the beans');
    const card = deckCard(page, id);
    await card.getByRole('button', { name: 'Start timer: Weed the beans' }).click();
    await expect(card.getByRole('button', { name: 'Stop timer: Weed the beans' })).toBeVisible();
    await page.clock.fastForward('40:00');
    await card.getByRole('button', { name: 'Stop timer: Weed the beans' }).click();
    await page.getByTestId('timer-stop-sheet').getByRole('button', { name: 'Done' }).click();
    const done = page.getByTestId('done-sheet');
    await expect(done.getByLabel('Minutes')).toHaveValue('40');
    await done.getByRole('button', { name: 'Save' }).click();
    await expect(card.locator('[data-card-status="done"]')).toHaveText('Done');
    expect(await savedMinutes(page, id)).toBe(40);
    await expect(card.getByRole('button', { name: /Stop timer/ })).toHaveCount(0);
  });

  test('time saved with no signal waits on the phone and uploads once', async ({
    page,
    context
  }) => {
    const id = await farmWithTask(page, 'timeroff', 'Mulch the garlic');
    const card = deckCard(page, id);
    await card.getByRole('button', { name: 'Start timer: Mulch the garlic' }).click();
    await expect(card.getByRole('button', { name: 'Stop timer: Mulch the garlic' })).toBeVisible();
    await page.clock.fastForward('20:00');
    await context.setOffline(true);
    await card.getByRole('button', { name: 'Stop timer: Mulch the garlic' }).click();
    await page.getByTestId('timer-stop-sheet').getByRole('button', { name: 'Save time' }).click();
    await expect(card.getByTestId('timer-status')).toHaveText(
      'Saved 20 min on this phone. It will upload when you have signal.'
    );
    await context.setOffline(false);
    await expect.poll(() => savedMinutes(page, id), { timeout: 20_000 }).toBe(20);
  });

  test('a running timer whose card is out of view shows a strip with Stop', async ({ page }) => {
    await farmWithTask(page, 'timerstrip', 'Turn the compost');
    await page
      .getByTestId('today-deck')
      .getByRole('button', { name: 'Start timer: Turn the compost' })
      .click();
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await page.waitForLoadState('networkidle');
    const strip = page.getByTestId('timer-strip');
    await expect(strip).toContainText('Timer running: Turn the compost, 0:00');
    await strip.getByRole('button', { name: 'Stop timer: Turn the compost' }).click();
    const sheet = page.getByTestId('timer-stop-sheet');
    await expect(sheet).toContainText('Less than a minute. Nothing to save.');
    await sheet.getByRole('button', { name: 'Discard' }).click();
    await expect(strip).toHaveCount(0);
  });

  test('stopping from the strip shows the outcome on screen', async ({ page }) => {
    const id = await farmWithTask(page, 'timerstripsave', 'Prune the berries');
    const card = deckCard(page, id);
    await card.getByRole('button', { name: 'Start timer: Prune the berries' }).click();
    await expect(card.getByRole('button', { name: 'Stop timer: Prune the berries' })).toBeVisible();
    await page.clock.fastForward('15:00');
    await expect(card.getByTestId('timer-clock')).toHaveText('0:15');
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await page.waitForLoadState('networkidle');
    const strip = page.getByTestId('timer-strip');
    await strip.getByRole('button', { name: 'Stop timer: Prune the berries' }).click();
    await page.getByTestId('timer-stop-sheet').getByRole('button', { name: 'Save time' }).click();
    await expect(strip).toHaveCount(0);
    await expect(page.getByTestId('timer-strip-status')).toHaveText('Saved 15 min.');
    await expect(page.getByTestId('timer-strip-status')).toBeVisible();
  });

  test('the Task Card page offers no Start on a task closed on this phone', async ({ page }) => {
    const id = await farmWithTask(page, 'timerclosed', 'Hill the potatoes');
    await page.route('**/api/tasks/close', (route) => route.abort('internetdisconnected'));
    await deckCard(page, id).getByRole('button', { name: 'Done: Hill the potatoes' }).click();
    await page.getByTestId('done-sheet').getByRole('button', { name: 'Done, skip time' }).click();
    await expect(deckCard(page, id).locator('[data-card-status="done"]')).toHaveText('Done');
    await page.goto(`/cards/task/tk_${id}`);
    await page.waitForLoadState('networkidle');
    const timer = page.getByTestId('task-timer');
    await expect(timer.getByRole('button', { name: 'Time on this task' })).toBeVisible();
    await expect(timer.getByRole('button', { name: /Start timer/ })).toHaveCount(0);
  });

  test('the offline Task Card page keeps the same timer', async ({ page }) => {
    const id = await farmWithTask(page, 'timercard', 'Check the fence');
    await deckCard(page, id).getByRole('button', { name: 'Start timer: Check the fence' }).click();
    await expect(
      deckCard(page, id).getByRole('button', { name: 'Stop timer: Check the fence' })
    ).toBeVisible();
    await page.goto(`/cards/task/tk_${id}`);
    await page.waitForLoadState('networkidle');
    const timer = page.getByTestId('task-timer');
    await expect(timer.getByRole('button', { name: 'Stop timer: Check the fence' })).toBeVisible();
    await page.clock.fastForward('10:00');
    await timer.getByRole('button', { name: 'Stop timer: Check the fence' }).click();
    const sheet = page.getByTestId('timer-stop-sheet');
    await expect(sheet.getByRole('button', { name: 'Done' })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Save time' }).click();
    await expect(timer.getByTestId('timer-status')).toHaveText('Saved 10 min.');
    expect(await savedMinutes(page, id)).toBe(10);
  });

  test('the timer row does not overflow a 375 px phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const id = await farmWithTask(page, 'timer375', 'Harvest the zucchini before they get huge');
    const card = deckCard(page, id);
    await card
      .getByRole('button', { name: 'Start timer: Harvest the zucchini before they get huge' })
      .click();
    await expect(card.getByTestId('timer-clock')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await card.getByRole('button', { name: /Stop timer/ }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  });
});
