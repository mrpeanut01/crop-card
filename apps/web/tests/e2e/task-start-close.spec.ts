import Database from 'better-sqlite3';
import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

// Phase 34A (taskclose): Start on a /today task opens the flow with the task,
// and saving the record closes the task in the same write.

const PORT = Number(process.env.E2E_PORT ?? 5173);
const DB_PATH = PORT === 5173 ? './.playwright-data/test.db' : `./.playwright-data/test-${PORT}.db`;

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function blockWithPlanting(page: Page, name: string, cropPluginId: string) {
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', { name });
  const { planting } = await post<{ planting: { id: string } }>(
    page,
    `/api/blocks/${block.id}/plantings`,
    { cropPluginId, plantingDate: Date.now() - 400 * 86_400_000 }
  );
  return { blockId: block.id, cropId: planting.id };
}

/** No screen makes a categorized task yet outside the demo farm and the
 *  planner, so the test stamps the kind the way those writers do. */
function stampTask(id: string, fields: { relatedEventTable?: string; category?: string }) {
  const db = new Database(DB_PATH);
  try {
    db.pragma('busy_timeout = 5000');
    db.prepare(
      'UPDATE tasks SET related_event_table = COALESCE(?, related_event_table), category = COALESCE(?, category) WHERE id = ?'
    ).run(fields.relatedEventTable ?? null, fields.category ?? null, id);
  } finally {
    db.close();
  }
}

async function addTask(
  page: Page,
  body: { title: string; blockId?: string; cropId?: string },
  kind: { relatedEventTable?: string; category?: string }
): Promise<string> {
  const { task } = await post<{ task: { id: string } }>(page, '/api/tasks', {
    kind: 'primary',
    scheduledFor: Date.now(),
    ...body
  });
  stampTask(task.id, kind);
  return task.id;
}

async function newFarm(page: Page) {
  await signInNewUser(page, 'taskclose');
  await createOnboardedFarm(page, { growing: ['garden'] });
}

function card(page: Page, id: string) {
  return page.locator(`[data-testid="today-deck"] .deck-card[data-task-id="${id}"]`);
}

async function startFromToday(page: Page, id: string, label: string, title: string) {
  await page.goto('/today');
  await page.waitForLoadState('networkidle');
  await card(page, id)
    .getByRole('link', { name: `${label}: ${title}` })
    .click();
  await page.waitForLoadState('networkidle');
}

async function expectDoneOnToday(page: Page, id: string) {
  await page.goto('/today');
  await page.waitForLoadState('networkidle');
  await expect(card(page, id).locator('[data-card-status="done"]')).toHaveText('Done');
}

async function taskOf(page: Page, id: string) {
  const res = await page.request.get(`/api/tasks/${id}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { primary: { completedAt?: number; relatedEventTable?: string } })
    .primary;
}

test.describe('Start closes the task outside the spray flows', () => {
  test.describe.configure({ timeout: 120_000 });

  test('harvest: Start, save, and the task is done on /today', async ({ page }) => {
    await newFarm(page);
    const { blockId, cropId } = await blockWithPlanting(page, 'Orchard row', 'apple-orchard');
    const id = await addTask(
      page,
      { title: 'Pick the apples', blockId, cropId },
      { relatedEventTable: 'harvest_event' }
    );

    await startFromToday(page, id, 'Start harvest', 'Pick the apples');
    await expect(page).toHaveURL(new RegExp(`/harvest\\?task=${id}&block=${blockId}&crop=`));
    const planting = page.locator('li.planting', { hasText: 'Orchard row' });
    await expect(planting.getByTestId('task-close-note')).toHaveText(
      'From the task: Pick the apples'
    );
    await planting.locator('#fb-qty').fill('40 lb');
    await planting.getByRole('button', { name: 'Record harvest' }).last().click();
    await expect(page.getByTestId('task-close-note')).toHaveText('Saved. The task is marked done.');

    expect((await taskOf(page, id)).relatedEventTable).toBe('harvest_event');

    // A second pick on the same page no longer talks about the closed task.
    await planting
      .getByRole('button', { name: /^Record (another pick|harvest)$/ })
      .first()
      .click();
    await expect(planting.getByTestId('task-close-note')).toHaveCount(0);
    await expect(page.getByTestId('task-close-note')).toHaveText('Saved. The task is marked done.');
    await planting.locator('#fb-qty').fill('10 lb');
    const second = page.waitForRequest('**/api/harvest/record');
    await planting.getByRole('button', { name: 'Record harvest' }).last().click();
    expect((await second).postDataJSON().taskId).toBeUndefined();
    await expect(page.getByTestId('task-close-note')).toHaveText('Saved. The task is marked done.');
    await expectDoneOnToday(page, id);
  });

  test('harvest of a different planting leaves the task open and says so', async ({ page }) => {
    await newFarm(page);
    const asked = await blockWithPlanting(page, 'Orchard row', 'apple-orchard');
    await blockWithPlanting(page, 'Back orchard', 'apple-orchard');
    const id = await addTask(
      page,
      { title: 'Pick the front row', blockId: asked.blockId, cropId: asked.cropId },
      { relatedEventTable: 'harvest_event' }
    );

    await startFromToday(page, id, 'Start harvest', 'Pick the front row');
    const other = page.locator('li.planting', { hasText: 'Back orchard' });
    await other.getByRole('button', { name: 'Record harvest' }).click();
    await expect(other.getByTestId('task-close-note')).toHaveText(
      'This is not the block or crop the task named, so the task will stay open.'
    );
    await other.locator('#fb-qty').fill('5 lb');
    await other.getByRole('button', { name: 'Record harvest' }).last().click();
    await expect(page.getByTestId('task-close-note')).toHaveText(
      'Saved. The task stays open because this record is for a different block or crop.'
    );
    expect((await taskOf(page, id)).completedAt ?? null).toBeNull();
  });

  test('scout: Start, save an observation, and the task is done', async ({ page }) => {
    await newFarm(page);
    const { blockId } = await blockWithPlanting(page, 'Bed 1', 'apple-orchard');
    const id = await addTask(page, { title: 'Walk bed 1', blockId }, { category: 'scout' });

    await startFromToday(page, id, 'Start scouting', 'Walk bed 1');
    await expect(page).toHaveURL(new RegExp(`/scout\\?task=${id}&block=${blockId}`));
    await page.locator('#scout-note').fill('Aphids on the new growth');
    await page.getByRole('button', { name: 'Save observation' }).click();
    await expect(page.getByTestId('task-close-note')).toHaveText('Saved. The task is marked done.');
    expect((await taskOf(page, id)).relatedEventTable).toBe('scout_observation');
    await expectDoneOnToday(page, id);
  });

  test('fertility: Start, record the application, and the task is done', async ({ page }) => {
    await newFarm(page);
    const { blockId } = await blockWithPlanting(page, 'Bed 2', 'apple-orchard');
    const id = await addTask(
      page,
      { title: 'Side-dress bed 2', blockId },
      { relatedEventTable: 'fertility_application' }
    );

    await startFromToday(page, id, 'Start feeding', 'Side-dress bed 2');
    await expect(page).toHaveURL(new RegExp(`/fertility\\?task=${id}&block=${blockId}`));
    await expect(page.getByTestId('task-close-note')).toHaveText('From the task: Side-dress bed 2');
    await page.getByTestId('fertility-source').fill('Urea (46-0-0)');
    await page.getByTestId('fertility-rate').fill('65');
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.getByTestId('task-close-note')).toHaveText('Saved. The task is marked done.');
    await expectDoneOnToday(page, id);
  });

  test('hay: Start, record the cutting, and the task is done', async ({ page }) => {
    await newFarm(page);
    const { blockId } = await blockWithPlanting(page, 'Hay field', 'alfalfa-vernema');
    const id = await addTask(
      page,
      { title: 'Cut the hay', blockId },
      { relatedEventTable: 'hay_cutting' }
    );

    await startFromToday(page, id, 'Start cutting', 'Cut the hay');
    await expect(page).toHaveURL(new RegExp(`/hay\\?task=${id}&block=${blockId}`));
    await page.getByRole('button', { name: 'Record cutting now (mow done)' }).click();
    await expect(page.getByTestId('task-close-note')).toHaveText('Saved. The task is marked done.');
    expect((await taskOf(page, id)).relatedEventTable).toBe('hay_cutting');
    await expectDoneOnToday(page, id);
  });
});
