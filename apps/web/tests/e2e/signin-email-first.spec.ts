import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './lib/test';

const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;

test.use({ viewport: { width: 375, height: 800 } });

async function latestCode(request: APIRequestContext, to: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(async () => {
      const res = await request.get(`${MAGIC_BASE}/_dev/outbox?to=${encodeURIComponent(to)}`);
      const body = (await res.json()) as { messages: Array<{ body: string }> };
      code = body.messages.at(-1)?.body.match(/sign-in code is (\d{6})\./)?.[1];
      return code;
    })
    .toBeTruthy();
  return code!;
}

async function expectNoOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
}

async function expectTapTarget(page: Page, name: string | RegExp, role: 'button' | 'link') {
  const box = await page.getByRole(role, { name }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
}

test.describe('email-first sign-in at 375px (magic-link)', () => {
  test.use({ baseURL: MAGIC_BASE });

  test('email is the primary path: link and backup code in one email', async ({ page }) => {
    const email = `first-${Date.now()}@example.test`;
    await page.goto('/');

    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Mobile number')).toHaveCount(0);
    await expect(page.getByText(/sign-in link and a 6-digit backup code/i)).toBeVisible();
    await expectTapTarget(page, /email me a sign-in link/i, 'button');
    await expectTapTarget(page, 'Use a phone number instead', 'link');
    await expectNoOverflow(page);

    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: /email me a sign-in link/i }).click();
    const status = page.getByRole('status').filter({ hasText: 'Check your email' });
    await expect(status).toContainText('backup code');
    await expect(page.getByLabel('6-digit code')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Use a different email' })).toBeVisible();
    await expectNoOverflow(page);

    await page.getByLabel('6-digit code').fill(await latestCode(page.request, email));
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('a phone number typed into the email field is pointed at the phone path', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email', { exact: true }).evaluate((el) => {
      (el as HTMLInputElement).type = 'text';
    });
    await page.getByLabel('Email', { exact: true }).fill('5715550199');
    await page.getByRole('button', { name: /email me a sign-in link/i }).click();
    await expect(page.getByRole('alert')).toContainText('Use a phone number instead');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  });

  test('SMS is a secondary path with a consent line and still signs in', async ({ page }) => {
    const local = `571557${String(Date.now()).slice(-4)}`;
    await page.goto('/');
    await page.getByRole('link', { name: 'Use a phone number instead' }).click();
    await expect(page).toHaveURL(/via=phone/);

    await expect(page.getByLabel('Mobile number')).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
    await expect(
      page.getByText(
        'CropCard will text you a sign-in code. Msg & data rates may apply. Reply STOP to opt out, HELP for help.'
      )
    ).toBeVisible();
    await expectTapTarget(page, /text me a code/i, 'button');
    await expectTapTarget(page, 'Use email instead', 'link');
    await expectNoOverflow(page);

    await page.getByLabel('Mobile number').fill(local);
    await page.getByRole('button', { name: /text me a code/i }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Check your texts' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Use email instead' })).toBeVisible();
    await expectNoOverflow(page);

    await page.getByLabel('6-digit code').fill(await latestCode(page.request, `+1${local}`));
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('"Use email instead" returns to the email form and keeps an invite', async ({ page }) => {
    await page.goto('/?via=phone&invite=abc123');
    await page.getByRole('link', { name: 'Use email instead' }).click();
    await expect(page).toHaveURL(/\/\?invite=abc123$/);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  });
});

test.describe('phone-only account at 375px', () => {
  test('/settings/account suggests adding an email', async ({ page }) => {
    const origin = new URL(test.info().project.use.baseURL ?? 'http://localhost:5173').origin;
    const headers = { 'x-sveltekit-action': 'true', origin };
    const local = `571558${String(Date.now()).slice(-4)}`;
    const signin = await page.request.post('/?/signin', {
      form: { identifier: local, channel: 'phone' },
      headers,
      maxRedirects: 0
    });
    expect(((await signin.json()) as { location?: string }).location).toBe('/onboarding');
    const farm = await page.request.post('/onboarding?/farm', {
      form: { farmName: `Phone Farm ${local}` },
      headers,
      maxRedirects: 0
    });
    expect(((await farm.json()) as { type?: string }).type).toBe('redirect');

    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    const nudge = page.getByRole('note', { name: 'Add an email' });
    await expect(nudge).toContainText('Add an email to sign in faster');
    await expectTapTarget(page, 'Add an email', 'button');
    await expectNoOverflow(page);

    await nudge.getByRole('button', { name: 'Add an email' }).click();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(nudge).toHaveCount(0);
  });
});
