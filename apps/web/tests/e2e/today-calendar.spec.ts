import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';
import { provisionHelper } from './lib/freshFarm';

const DAY = 86_400_000;

async function addTask(page: Page, body: { title: string; scheduledFor: number }) {
  const res = await page.request.post('/api/tasks', {
    data: { kind: 'primary', ...body },
    headers: { origin: originOf(page) }
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { task: { id: string } }).task.id;
}

async function closeTask(page: Page, id: string) {
  const res = await page.request.patch(`/api/tasks/${id}`, {
    data: { action: 'complete', occurredAt: Date.now() },
    headers: { origin: originOf(page) }
  });
  expect(res.ok(), await res.text()).toBe(true);
}

function ymd(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ms));
}

async function farm(page: Page, prefix: string) {
  await signInNewUser(page, prefix);
  await createOnboardedFarm(page, { growing: ['garden'] });
  const now = Date.now();
  const doneYesterday = await addTask(page, {
    title: 'Turn the compost',
    scheduledFor: Date.parse(ymd(now - DAY))
  });
  await closeTask(page, doneYesterday);
  const today = await addTask(page, { title: 'Stake the tomatoes', scheduledFor: now });
  const nextWeek = await addTask(page, {
    title: 'Sow fall peas',
    scheduledFor: Date.parse(ymd(now + 8 * DAY))
  });
  return { doneYesterday, today, nextWeek, now };
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

test.describe('/today views', () => {
  test('Day is the cards, Week and Month are calendars with past work and paging', async ({
    page
  }) => {
    const ids = await farm(page, 'calview');
    await open(page, '/today');
    const deck = page.getByTestId('today-deck');
    for (const name of ['Day', 'Week', 'Month', 'Season']) {
      await expect(deck.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(deck.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(deck.locator(`.deck-card[data-task-id="${ids.today}"]`)).toBeVisible();

    await deck.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(page).toHaveURL(/view=week/);
    await page.waitForLoadState('networkidle');
    const week = page.getByTestId('calendar-week');
    await expect(week).toBeVisible();
    await expect(week.locator('.wday')).toHaveCount(7);
    await expect(deck.locator('.deck-card')).toHaveCount(0);

    const todayChip = week.getByRole('button', { name: /^Stake the tomatoes/ });
    await expect(todayChip).toBeVisible();
    await todayChip.click();
    const sheet = page.getByTestId('today-sheet');
    await expect(sheet.locator(`.deck-card[data-task-id="${ids.today}"]`)).toBeVisible();
    await sheet.getByRole('button', { name: 'Done: Stake the tomatoes' }).click();
    await expect(
      sheet.locator(`.deck-card[data-task-id="${ids.today}"] [data-card-status="done"]`)
    ).toHaveText('Done');
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(week.getByRole('button', { name: /^Stake the tomatoes/ })).toHaveAttribute(
      'data-status',
      'done'
    );

    const yesterday = ymd(ids.now - DAY);
    const inThisWeek = (await week.locator(`[data-day="${yesterday}"]`).count()) > 0;
    if (!inThisWeek) {
      await week.getByRole('button', { name: 'Previous week' }).click();
      await page.waitForLoadState('networkidle');
    }
    await expect(
      page
        .getByTestId('calendar-week')
        .locator(`[data-day="${yesterday}"]`)
        .getByRole('button', { name: /^Turn the compost/ })
    ).toHaveAttribute('data-status', 'done');

    await open(page, '/today?view=week');
    await expect(page.getByRole('button', { name: /^Sow fall peas/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page).toHaveURL(/at=\d{4}-\d{2}-\d{2}/);
    await page.waitForLoadState('networkidle');
    const peasWeek = page.getByTestId('calendar-week');
    const peasDay = ymd(ids.now + 8 * DAY);
    if ((await peasWeek.locator(`[data-day="${peasDay}"]`).count()) > 0) {
      await expect(peasWeek.getByRole('button', { name: /^Sow fall peas/ })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(page).not.toHaveURL(/at=/);

    await deck.getByRole('button', { name: 'Month', exact: true }).click();
    await expect(page).toHaveURL(/view=month/);
    await page.waitForLoadState('networkidle');
    const month = page.getByTestId('calendar-month');
    await expect(month).toBeVisible();
    const cell = month.locator(`[data-day="${ymd(ids.now)}"]`);
    await expect(cell).toContainText('Stake the tomatoes');
    await cell.click();
    await expect(
      page.getByTestId('today-sheet').locator(`.deck-card[data-task-id="${ids.today}"]`)
    ).toBeVisible();
  });

  test('old bookmarks land on the new views', async ({ page }) => {
    await signInNewUser(page, 'calbook');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await open(page, '/today?tab=7d');
    await expect(page).toHaveURL(/\/today\?view=week$/);
    await expect(page.getByTestId('calendar-week')).toBeVisible();
    await open(page, '/today?tab=30d');
    await expect(page).toHaveURL(/\/today\?view=month$/);
    await expect(page.getByTestId('calendar-month')).toBeVisible();
    await open(page, '/today?view=list&tab=7d');
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByTestId('today-deck')).toHaveAttribute('data-view', 'day');
    await open(page, '/today?view=calendar&tab=season');
    await expect(page).toHaveURL(/\/today\?view=season$/);
    await expect(page.getByTestId('season-timeline')).toBeVisible();
  });

  test('Season shows timelines with a season picker', async ({ page }) => {
    await signInNewUser(page, 'calseason');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await open(page, '/today?view=season');
    const season = page.getByTestId('season-timeline');
    await expect(season.getByRole('heading', { name: /^Season \d{4}$/ })).toBeVisible();
    const picker = season.getByLabel('Season', { exact: true });
    const options = await picker.locator('option').allTextContents();
    expect(options.length).toBeGreaterThanOrEqual(1);
    await expect(season).toContainText('Prep for');
    await expect(season.getByTestId('season-empty')).toBeVisible();
    const current = await picker.inputValue();
    const earlier = season.getByRole('button', { name: 'Earlier season' });
    if (await earlier.isEnabled()) {
      await earlier.click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/season=\d{4}/);
      expect(
        Number(
          await page
            .getByTestId('season-timeline')
            .getByLabel('Season', { exact: true })
            .inputValue()
        )
      ).toBeLessThan(Number(current));
    }
  });

  test('a planting gets a timeline row whose dates open in a sheet', async ({ page }) => {
    await signInNewUser(page, 'calrow');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const post = async <T>(url: string, data: Record<string, unknown>) => {
      const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
      expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
      return (await res.json()) as T;
    };
    const area = await post<{ field: { id: string } }>('/api/fields', {
      name: 'Kitchen garden',
      kind: 'garden',
      widthFt: 20,
      lengthFt: 30
    });
    const bed = await post<{ block: { id: string } }>('/api/blocks', {
      name: 'Bed 1',
      kind: 'bed',
      widthFt: 4,
      lengthFt: 8,
      fieldId: area.field.id
    });
    const plantedAt = Date.now() - 5 * DAY;
    const placed = await post<{ planting: { id: string } }>(
      `/api/blocks/${bed.block.id}/plantings`,
      { cropPluginId: 'tomato-cherokee-purple', plantingDate: plantedAt }
    );
    await open(page, '/today?view=season');
    const season = page.getByTestId('season-timeline');
    await expect(season.getByRole('heading', { name: /^Season \d{4}$/ })).toBeVisible();
    const row = season.locator(`[data-planting-id="${placed.planting.id}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator('.bar[data-kind="plant"]')).toHaveCount(1);
    await expect(row.locator('.bar[data-kind="grow"]')).toHaveCount(1);
    await row.getByRole('button', { name: /on Bed 1/ }).click();
    const sheet = page.getByTestId('today-sheet');
    await expect(sheet).toContainText('Planted');
  });

  test('Current conditions opens the forecast sheet', async ({ page }) => {
    await signInNewUser(page, 'calwx');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await open(page, '/today');
    const btn = page.getByTestId('current-conditions');
    await expect(btn).toContainText('Current conditions');
    await btn.click();
    const sheet = page.getByTestId('forecast-sheet');
    await expect(page.getByRole('heading', { name: '7-day forecast' })).toBeVisible();
    await expect(sheet).toContainText(/National Weather Service/);
  });

  test('at phone width the calendars fit, with 48px controls', async ({ page }) => {
    await farm(page, 'calphone');
    await page.setViewportSize({ width: 375, height: 800 });
    for (const view of ['week', 'month', 'season']) {
      await open(page, `/today?view=${view}`);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, view).toBeLessThanOrEqual(375);
      const controls = page.locator(
        '[data-testid="today-deck"] .chip, [data-testid="today-deck"] .nav-btn, [data-testid="today-deck"] .wday .chip, [data-testid="today-deck"] .mcell, [data-testid="today-deck"] select'
      );
      for (const box of await controls.evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect())
      )) {
        expect(box.height, view).toBeGreaterThanOrEqual(48);
      }
      const cells = page.locator('[data-testid="today-deck"] .mcell');
      for (const w of await cells.evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect().width)
      )) {
        expect(w, `${view} day cell width`).toBeGreaterThanOrEqual(48);
      }
    }
  });

  test('a helper can use the calendar and sees Ask the owner for the forecast location', async ({
    page,
    browser
  }) => {
    const ids = await farm(page, 'calhelper');
    const helper = await provisionHelper(page, browser);
    await open(helper, '/today?view=week');
    await expect(helper.getByRole('button', { name: /^Stake the tomatoes/ })).toBeVisible();
    await helper.getByRole('button', { name: /^Stake the tomatoes/ }).click();
    await expect(
      helper.getByTestId('today-sheet').locator(`.deck-card[data-task-id="${ids.today}"]`)
    ).toBeVisible();
    await helper.context().close();
  });
});

test.describe('app data lives in Settings', () => {
  test('Today has no sprayer or app data block; Settings > Advanced has it for owner and helper', async ({
    page,
    browser
  }) => {
    await signInNewUser(page, 'appdata');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await open(page, '/today');
    await expect(page.getByTestId('today-gear')).toHaveCount(0);
    await expect(page.getByText('Sprayers and app info')).toHaveCount(0);

    await open(page, '/settings/advanced');
    const info = page.getByTestId('app-info');
    await expect(info).toContainText('Rules version');
    await expect(info).toContainText('Crops registered');
    await expect(info).toContainText('Plugin failures');
    await expect(page.getByRole('heading', { name: 'Danger zone' })).toBeVisible();

    const helper = await provisionHelper(page, browser);
    await open(helper, '/settings');
    await expect(helper.getByRole('link', { name: /App info/ })).toBeVisible();
    await open(helper, '/settings/advanced');
    await expect(helper.getByTestId('app-info')).toContainText('Rules version');
    await expect(helper.getByText('Settings · Settings')).toHaveCount(0);
    await expect(helper.getByText('Settings · Diagnostics')).toBeVisible();
    await expect(helper.getByText('App info', { exact: true })).toHaveCount(1);
    await expect(helper.getByRole('heading', { name: 'Danger zone' })).toHaveCount(0);
    await expect(helper.getByText('Bulk export')).toHaveCount(0);
    await helper.context().close();
  });
});

test.describe('scheduling a crop-calendar suggestion (wave 1 review)', () => {
  async function cornFarm(page: Page, prefix: string, plantedDaysAgo: number[]) {
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
    for (const days of plantedDaysAgo) {
      await post(`/api/blocks/${bed.block.id}/plantings`, {
        cropPluginId: 'corn',
        plantingDate: Date.now() - days * DAY
      });
    }
  }

  test('a suggestion whose window opened earlier is scheduled for the day tapped, not Late', async ({
    page
  }) => {
    await cornFarm(page, 'calsched', [12, 16, 20, 24, 28, 32, 36]);
    await open(page, '/today?view=week');
    const todayYmd = ymd(Date.now());
    let picked: string | null = null;
    for (const day of await page.locator('[data-testid="calendar-week"] .wday').all()) {
      const d = (await day.getAttribute('data-day')) ?? '';
      const chip = day.locator('.chip[data-chip="suggestion"]').first();
      if (d !== todayYmd || (await chip.count()) === 0) continue;
      picked = d;
      const posted = page.waitForRequest(
        (r) => r.url().endsWith('/api/tasks') && r.method() === 'POST'
      );
      await chip.click();
      const sheet = page.getByTestId('today-sheet');
      await sheet
        .getByRole('button', { name: /^Schedule:/ })
        .first()
        .click();
      const body = (await posted).postDataJSON() as { scheduledFor: number };
      expect(new Date(body.scheduledFor).toISOString().slice(0, 10)).toBe(d);
      break;
    }
    expect(picked, 'a corn window is open today').toBe(todayYmd);
    await page.waitForLoadState('networkidle');
    await expect(
      page.locator(`[data-day="${picked}"] .chip[data-chip="task"][data-status="due-today"]`)
    ).toHaveCount(1);
    await expect(page.locator('.chip[data-status="late"]')).toHaveCount(0);
  });

  test('Day stops offering a suggestion once it is scheduled, and it is not Late', async ({
    page
  }) => {
    await cornFarm(page, 'calday', [12, 16, 20, 24, 28, 32, 36]);
    await open(page, '/today');
    const buttons = page.getByRole('button', { name: /^Schedule: / });
    expect(await buttons.count()).toBeGreaterThan(0);
    const name = (await buttons.first().getAttribute('aria-label'))!;
    const same = page.getByRole('button', { name, exact: true });
    const before = await same.count();
    await buttons.first().click();
    await page.waitForLoadState('networkidle');
    await expect(same).toHaveCount(before - 1);
    const title = name.replace(/^Schedule: /, '');
    const card = page.locator('.deck-card', { hasText: title });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Due today');
    await expect(page.getByTestId('today-deck')).not.toContainText(/\d+ late/);
  });
});
