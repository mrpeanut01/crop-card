import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

const DAY = 86_400_000;

async function addTask(page: Page, body: { title: string; scheduledFor: number }) {
  const res = await page.request.post('/api/tasks', {
    data: { kind: 'primary', ...body },
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

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
}

function printed(page: Page) {
  return page.evaluate(() => (window as unknown as { printed: number }).printed);
}

test.describe('printable Week and Month Cards', () => {
  test('Print week on /today prints a landscape week with no spray rates', async ({ page }) => {
    await stubPrint(page);
    await signInNewUser(page, 'printwk');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const now = Date.now();
    await addTask(page, { title: 'Stake the tomatoes', scheduledFor: now });
    await addTask(page, { title: 'Spray Roundup 2 qt per acre', scheduledFor: now + 60_000 });

    await open(page, '/today?view=week');
    const button = page.getByTestId('print-calendar');
    await expect(button).toHaveText('Print week');
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
    await expect(button).toHaveAttribute('href', `/cards/week/wk_${ymd(now)}?print=1`);

    await button.click();
    await expect(page).toHaveURL(/\/cards\/week\/wk_/);
    await page.waitForLoadState('networkidle');
    await expect.poll(() => printed(page), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(page).not.toHaveURL(/print=1/);

    const screenCard = page.locator('article[data-card-kind="week"][data-variant="screen"]');
    await expect(screenCard).toContainText('Stake the tomatoes');
    await expect(screenCard).toContainText('Spray task');
    await expect(page.getByTestId('full-page-note')).toContainText('Landscape');

    await page.emulateMedia({ media: 'print' });
    const sheet = page.locator('.card-print-sheet');
    await expect(sheet).toBeVisible();
    const pageEl = sheet.locator('.sheet-page[data-page-layout="letter-landscape"]');
    await expect(pageEl).toHaveCount(1);
    const grid = pageEl.getByTestId('card-calendar-grid');
    await expect(grid.locator('thead th')).toHaveCount(7);
    await expect(grid).toContainText('Stake the tomatoes');
    await expect(grid).toContainText('Spray task');
    const text = (await sheet.textContent()) ?? '';
    expect(text).not.toContain('Roundup');
    expect(text).not.toMatch(/2 qt/);
    await page.emulateMedia({ media: 'screen' });
  });

  test('Print month on /today and from the sowing calendar open the month card', async ({
    page
  }) => {
    await signInNewUser(page, 'printmo');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const now = Date.now();
    await addTask(page, { title: 'Turn the compost', scheduledFor: now });
    const month = ymd(now).slice(0, 7);

    await open(page, '/today?view=month');
    const button = page.getByTestId('print-calendar');
    await expect(button).toHaveText('Print month');
    await expect(button).toHaveAttribute('href', `/cards/month/mo_${month}?print=1`);

    await open(page, '/plan/calendar');
    const link = page.getByTestId('print-month-tasks');
    await expect(link).toHaveText("Print this month's tasks");
    await expect(link).toHaveAttribute('href', `/cards/month/mo_${month}?print=1`);

    await open(page, `/cards/month/mo_${month}`);
    const card = page.locator('article[data-card-kind="month"][data-variant="screen"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Turn the compost');

    await open(page, '/cards/month/mo_2019-01');
    const outside = page.getByTestId('calendar-outside-window');
    await expect(outside).toContainText('cover the last two weeks and the next two months');
    await expect(outside.getByRole('link', { name: /Today/ })).toHaveAttribute(
      'href',
      '/today?view=month&at=2019-01-01'
    );
  });

  test('no horizontal overflow at 375 px on the week view and the week card', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInNewUser(page, 'printnarrow');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await addTask(page, { title: 'Weed the carrots', scheduledFor: Date.now() + DAY });
    for (const path of ['/today?view=week', `/cards/week/wk_${ymd(Date.now())}`]) {
      await open(page, path);
      if (path.startsWith('/cards'))
        await expect(page.locator('article[data-card-kind="week"]').first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
