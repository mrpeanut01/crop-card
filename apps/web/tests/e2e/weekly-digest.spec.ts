import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';
import { provisionHelper } from './lib/freshFarm';

// Phase 32F F4. The Monday summary: the printable digest page, the /today
// card (Mondays only), the /c/dg_ short link and the opt-in toggles.

const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;
const FARM_ZONE = 'America/New_York';

function farmToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FARM_ZONE }).format(new Date());
}

async function addTask(page: Page, title: string, ymd: string): Promise<void> {
  const res = await page.request.post('/api/tasks', {
    data: { title, kind: 'primary', scheduledFor: Date.parse(`${ymd}T00:00:00Z`) },
    headers: { origin: originOf(page) }
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function newFarm(page: Page): Promise<void> {
  await signInNewUser(page, 'digest');
  await createOnboardedFarm(page, { growing: ['garden'] });
}

test.describe('Monday summary', () => {
  test('owner and helper read and print their own summary, with no money', async ({
    page,
    browser
  }) => {
    await newFarm(page);
    const today = farmToday();
    await addTask(page, 'Weed the onion bed', today);
    await addTask(page, 'Old overdue pruning', '2020-01-06');

    await page.goto('/today/digest');
    await page.waitForLoadState('networkidle');
    const card = page.locator('.no-print article').first();
    await expect(card.getByRole('heading', { name: 'Your week' })).toBeVisible();
    await expect(card).toContainText('Weed the onion bed');
    await expect(card).toContainText('Tasks this week');
    await expect(card).toContainText('Safety alerts are not in this summary.');
    await expect(card).not.toContainText('$');
    await expect(card).not.toContainText('Old overdue pruning');
    const print = page.getByTestId('digest-print');
    const box = await print.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

    const helper = await provisionHelper(page, browser);
    await helper.goto('/today/digest');
    await helper.waitForLoadState('networkidle');
    const helperCard = helper.locator('.no-print article').first();
    await expect(helperCard).toContainText('Your tasks this week');
    await expect(helperCard).toContainText('Not assigned to anyone');
    await expect(helperCard).not.toContainText('Weed the onion bed');
    await expect(helperCard).not.toContainText('$');
    await helper.context().close();
  });

  test('the page fits a 375px phone', async ({ page }) => {
    await newFarm(page);
    await addTask(page, 'A task with a fairly long name to test wrapping on phones', farmToday());
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/today/digest');
    await page.waitForLoadState('networkidle');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });

  test('the /today card shows on Monday only', async ({ page }) => {
    await newFarm(page);
    await addTask(page, 'Weed the onion bed', farmToday());
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    const digest = page.locator('[data-testid="advice-card"][data-kind="digest"]');
    const isMonday = new Date(`${farmToday()}T00:00:00Z`).getUTCDay() === 1;
    if (isMonday) {
      await expect(digest).toBeVisible();
      await expect(digest).toContainText('1 task due this week.');
      await expect(digest.getByRole('link', { name: 'Print this summary' })).toBeVisible();
      await expect(digest).not.toContainText('$');
    } else {
      await expect(digest).toHaveCount(0);
    }
  });

  test('a dg_ short link opens /today', async ({ page }) => {
    await newFarm(page);
    await page.goto('/c/dg_2026-09-28');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/today(\?|$)/);
  });
});

test.describe('Monday summary opt-in', () => {
  test.use({ baseURL: MAGIC_BASE });

  test('the email and push toggles are off until turned on, and the email one keeps', async ({
    page
  }) => {
    const email = `digest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    const res = await page.request.post('/api/auth/magic-link', { data: { email } });
    expect(res.status()).toBe(200);
    let token = '';
    await expect
      .poll(async () => {
        const out = await page.request.get(`/_dev/outbox?to=${encodeURIComponent(email)}`);
        const msgs = ((await out.json()) as { messages: { body: string }[] }).messages;
        const link = msgs.at(-1)?.body.match(/https?:\/\/\S+\/auth\/verify\?\S+/)?.[0];
        token = link ? (new URL(link).searchParams.get('token') ?? '') : '';
        return token;
      })
      .toBeTruthy();
    const confirm = await page.request.post('/auth/verify?/confirm', {
      form: { token },
      headers: { 'x-sveltekit-action': 'true', origin: MAGIC_BASE },
      maxRedirects: 0
    });
    expect(confirm.status()).toBe(200);
    await createOnboardedFarm(page, { growing: ['garden'] });

    await page.goto('/settings/notifications');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Monday summary', { exact: true }).first()).toBeVisible();
    const toggle = page.getByRole('checkbox', { name: /Email me: Monday summary/ });
    await expect(toggle).not.toBeChecked();
    await expect(
      page.getByText('Safety alerts still come on their own.', { exact: false }).first()
    ).toBeVisible();
    await toggle.check();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('checkbox', { name: /Email me: Monday summary/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Email me: Decon due/ })).not.toBeChecked();

    await page.getByRole('checkbox', { name: /Email me: Monday summary/ }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('checkbox', { name: /Email me: Monday summary/ })
    ).not.toBeChecked();
  });
});
