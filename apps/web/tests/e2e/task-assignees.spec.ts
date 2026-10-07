import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';

// Phase 32F F1: owners give jobs to farm members, helpers see theirs under
// Mine, and time picked on Done is saved once, even from an offline replay.

const DAY = 86_400_000;

function originOf(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function seed(page: Page) {
  await provisionEmptyFarm(page);
  const growing = await page.request.post('/onboarding?/growing', {
    data: 'growing=garden',
    headers: {
      'x-sveltekit-action': 'true',
      origin: originOf(page),
      'content-type': 'application/x-www-form-urlencoded'
    },
    maxRedirects: 0
  });
  expect(((await growing.json()) as { location?: string }).location).toBe('/today');
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Kitchen garden',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Bed 1',
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    fieldId: field.id
  });
  const tomato = await post<{ planting?: { id: string }; id?: string }>(
    page,
    `/api/blocks/${block.id}/plantings`,
    { cropPluginId: 'tomato-cherokee-purple', plantingDate: Date.now() - 5 * DAY }
  );
  const cropId = tomato.planting?.id ?? tomato.id ?? '';
  const now = Date.now();
  const task = async (title: string, extra: Record<string, unknown> = {}) =>
    (
      await post<{ task: { id: string } }>(page, '/api/tasks', {
        title,
        kind: 'primary',
        scheduledFor: now,
        ...extra
      })
    ).task.id;
  return {
    cropId,
    stake: await task('Stake the tomatoes', { cropId, blockId: block.id }),
    weed: await task('Weed the onions'),
    mulch: await task('Mulch the paths')
  };
}

function card(page: Page, id: string) {
  return page.locator(`[data-testid="today-deck"] .deck-card[data-task-id="${id}"]`);
}

test.describe('task assignees and time on Done', () => {
  test.describe.configure({ timeout: 150_000 });

  test('a solo farm gets no Mine/Everyone filter and no Assign button', async ({ page }) => {
    const ids = await seed(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await expect(card(page, ids.stake)).toBeVisible();
    await expect(page.getByTestId('who-filter')).toHaveCount(0);
    await expect(card(page, ids.stake).getByRole('button', { name: /^Assign/ })).toHaveCount(0);

    const far = new Date(Date.now() + 120 * DAY).toISOString().slice(0, 10);
    await page.goto(`/today?view=month&at=${far}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('print-calendar')).toHaveCount(0);
    await expect(page.getByTestId('print-calendar-range')).toBeVisible();
    await page.goto('/today?view=month');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('print-calendar')).toBeVisible();
  });

  test('an owner assigns a task and the helper sees it under Mine', async ({ page, browser }) => {
    const ids = await seed(page);
    const helper = await provisionHelper(page, browser);

    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    const who = page.getByTestId('who-filter');
    await expect(who.getByRole('button', { name: 'Everyone' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await card(page, ids.stake).getByRole('button', { name: 'Assign: Stake the tomatoes' }).click();
    const sheet = page.getByTestId('assign-sheet');
    const person = sheet.getByRole('button', { name: /^helper-/ });
    await expect(person).toBeVisible();
    await expect(sheet).not.toContainText('@');
    await person.click();
    await page.waitForLoadState('networkidle');
    await expect(card(page, ids.stake)).toContainText('Assigned to');
    await expect(card(page, ids.stake)).toContainText(/helper-/);
    await expect(card(page, ids.weed)).not.toContainText('Assigned to');

    await helper.goto('/today');
    await helper.waitForLoadState('networkidle');
    const helperWho = helper.getByTestId('who-filter');
    await expect(helperWho.getByRole('button', { name: 'Mine' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(card(helper, ids.stake)).toBeVisible();
    await expect(card(helper, ids.weed)).toHaveCount(0);
    await expect(card(helper, ids.stake).getByRole('button', { name: /^Assign/ })).toHaveCount(0);
    const more = helper.getByTestId('more-for-everyone');
    await expect(more).toHaveText('2 more tasks for everyone');
    await more.click();
    await expect(helper).toHaveURL(/who=all/);
    await helper.waitForLoadState('networkidle');
    await expect(card(helper, ids.weed)).toBeVisible();
    await expect(card(helper, ids.mulch)).toBeVisible();

    const refused = await helper.request.patch(`/api/tasks/${ids.weed}`, {
      data: { action: 'assign', assigneeUserId: null },
      headers: { origin: originOf(helper) }
    });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ error: 'Ask the owner.', askOwner: true });

    await helper.setViewportSize({ width: 375, height: 800 });
    await helper.goto('/today?who=mine');
    await helper.waitForLoadState('networkidle');
    const scrollWidth = await helper.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
    for (const box of await helperWho
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
    await helper.context().close();
  });

  test('a helper closes a task with 30 minutes offline, and it replays once', async ({
    page,
    browser
  }) => {
    const ids = await seed(page);
    const helper = await provisionHelper(page, browser);
    await helper.goto('/today?who=all');
    await helper.waitForLoadState('networkidle');

    await helper.context().setOffline(true);
    await card(helper, ids.stake).getByRole('button', { name: 'Done: Stake the tomatoes' }).click();
    const sheet = helper.getByTestId('done-sheet');
    for (const chip of ['15 m', '30 m', '1 h', '2 h', 'Other']) {
      const box = await sheet.getByText(chip, { exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }
    await sheet.getByRole('button', { name: 'Done, 30 min' }).click();
    await expect(card(helper, ids.stake).getByText('Will save when online')).toBeVisible();

    await helper.context().setOffline(false);
    await helper.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(card(helper, ids.stake).getByText('Will save when online')).toHaveCount(0, {
      timeout: 20_000
    });
    await helper.evaluate(() => window.dispatchEvent(new Event('online')));
    await helper.reload();
    await helper.waitForLoadState('networkidle');
    await expect(card(helper, ids.stake).locator('[data-card-status="done"]')).toHaveText('Done');

    // The owner's request context sat idle through the helper's offline flow,
    // past the preview server's 5 s keep-alive timeout, so its pooled socket can
    // be reset under the request. Unlike the browser, the API context does not
    // retry that on its own; these GETs are idempotent.
    const hours = await page.request.get(`/api/plantings/${ids.cropId}/hours`, {
      maxRetries: 2
    });
    expect(hours.ok(), await hours.text()).toBe(true);
    const body = (await hours.json()) as {
      totalMinutes: number;
      byPerson: { name: string; minutes: number }[];
    };
    expect(body.totalMinutes).toBe(30);
    expect(body.byPerson).toHaveLength(1);
    expect(body.byPerson[0].name).toMatch(/^helper-/);

    const helperHours = await helper.request.get(`/api/plantings/${ids.cropId}/hours`, {
      maxRetries: 2
    });
    expect(helperHours.status()).toBe(403);

    await page.goto(`/cards/planting/pl_${ids.cropId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('planting-hours')).toContainText('30 min');
    await helper.context().close();
  });
});
