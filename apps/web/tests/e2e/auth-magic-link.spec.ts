import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './lib/test';
import { signInAsDemoOwner } from './lib/auth';

// Mirrors playwright.config.ts: the magic-link preview runs on E2E_PORT + 1.
const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;

async function latestLink(request: APIRequestContext, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const res = await request.get(`${MAGIC_BASE}/_dev/outbox?to=${encodeURIComponent(email)}`);
      const body = (await res.json()) as { messages: Array<{ body: string }> };
      const last = body.messages.at(-1);
      link = last?.body.match(/https?:\/\/\S+\/auth\/verify\?\S+/)?.[0];
      return link;
    })
    .toBeTruthy();
  return link!;
}

async function latestMessage(
  request: APIRequestContext,
  to: string,
  pattern: RegExp
): Promise<RegExpMatchArray> {
  let match: RegExpMatchArray | null = null;
  await expect
    .poll(async () => {
      const res = await request.get(`${MAGIC_BASE}/_dev/outbox?to=${encodeURIComponent(to)}`);
      const body = (await res.json()) as { messages: Array<{ body: string }> };
      match = body.messages.at(-1)?.body.match(pattern) ?? null;
      return match;
    })
    .toBeTruthy();
  return match!;
}

test.describe('AUTH_MODE=magic-link', () => {
  test.use({ baseURL: MAGIC_BASE });

  test('request link → email → confirm → /today with the owner session', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Try the demo')).toHaveCount(0);

    await page.getByLabel('Email or mobile number').fill('owner@cropcard.local');
    await page.getByRole('button', { name: /email me a sign-in link/i }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Check your email' })).toBeVisible();

    const link = await latestLink(page.request, 'owner@cropcard.local');
    expect(new URL(link).origin).toBe(MAGIC_BASE);
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Finish signing in' })).toBeVisible();
    await expect(page.getByText('owner@cropcard.local')).toBeVisible();
    await page.getByRole('button', { name: /continue to cropcard/i }).click();
    await expect(page).toHaveURL(/\/today$/);

    // Single use: the same link now shows the recovery screen.
    await page.context().clearCookies();
    await page.goto(link);
    await expect(page.getByRole('heading', { name: "Link can't be used" })).toBeVisible();
    await expect(page.getByText(/already been used/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send a new link/i })).toBeVisible();
  });

  test('the 6-digit code from the email signs in on another device', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email or mobile number').fill('owner@cropcard.local');
    await page.getByRole('button', { name: /email me a sign-in link/i }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Check your email' })).toBeVisible();

    const body = await latestMessage(page.request, 'owner@cropcard.local', /code instead: (\d{6})/);
    await page.getByLabel('6-digit code').fill(body[1]);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/today$/);
  });

  test('a new mobile number signs up by SMS code and lands on /onboarding', async ({ page }) => {
    const local = `571555${String(Date.now()).slice(-4)}`;
    const e164 = `+1${local}`;
    await page.goto('/');
    await page.getByLabel('Email or mobile number').fill(local);
    await page.getByRole('button', { name: /text me a code/i }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Check your texts' })).toBeVisible();

    const body = await latestMessage(page.request, e164, /^(\d{6}) is your CropCard sign-in code/);
    await page.getByLabel('6-digit code').fill(body[1]);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('a wrong code is rejected and the code form stays up', async ({ page }) => {
    const local = `571556${String(Date.now()).slice(-4)}`;
    await page.goto('/');
    await page.getByLabel('Email or mobile number').fill(local);
    await page.getByRole('button', { name: /text me a code/i }).click();
    const body = await latestMessage(page.request, `+1${local}`, /^(\d{6}) /);
    await page.getByLabel('6-digit code').fill(body[1] === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toContainText("didn't match");
    await expect(page.getByLabel('6-digit code')).toBeVisible();
  });

  test('a brand-new email lands on /onboarding', async ({ page }) => {
    const email = `new-${Date.now()}@example.test`;
    const res = await page.request.post('/api/auth/magic-link', { data: { email } });
    expect(res.status()).toBe(200);
    await page.goto(await latestLink(page.request, email));
    await page.getByRole('button', { name: /continue to cropcard/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('superadmin without assignments lands on /admin/owners', async ({ page }) => {
    await page.request.post('/api/auth/magic-link', {
      data: { email: 'superadmin@cropcard.local' }
    });
    await page.goto(await latestLink(page.request, 'superadmin@cropcard.local'));
    await page.getByRole('button', { name: /continue to cropcard/i }).click();
    await expect(page).toHaveURL(/\/admin\/owners/);
  });

  test('the API answers identically for known and unknown emails', async ({ request }) => {
    const known = await request.post('/api/auth/magic-link', {
      data: { email: 'helper@cropcard.local' }
    });
    const unknown = await request.post('/api/auth/magic-link', {
      data: { email: `nobody-${Date.now()}@example.test` }
    });
    expect(known.status()).toBe(200);
    expect(unknown.status()).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    const bad = await request.post('/api/auth/magic-link', { data: { email: 'nope' } });
    expect(bad.status()).toBe(400);
  });

  test('direct email + demo sign-in are refused server-side', async ({ request }) => {
    for (const [action, form] of [
      ['signin', { email: 'owner@cropcard.local' }],
      ['demo', { role: 'owner' }]
    ] as const) {
      const res = await request.post(`/?/${action}`, {
        form,
        headers: { 'x-sveltekit-action': 'true', origin: MAGIC_BASE },
        maxRedirects: 0
      });
      const body = (await res.json().catch(() => null)) as { type?: string; status?: number };
      expect(body?.type).toBe('error');
      expect(res.headers()['set-cookie'] ?? '').not.toContain('cropcard.session');
    }
    const today = await request.get('/today', { maxRedirects: 0 });
    expect(today.status()).toBe(303);
  });

  test('an invalid token shows the recovery page', async ({ page }) => {
    await page.goto('/auth/verify?token=not-a-real-token');
    await expect(page.getByRole('heading', { name: "Link can't be used" })).toBeVisible();
  });
});

test.describe('AUTH_MODE=direct (default)', () => {
  test('email form signs straight in', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Try the demo')).toBeVisible();
    await page.getByLabel('Email').fill('owner@cropcard.local');
    await page.getByRole('button', { name: 'Continue →' }).click();
    await expect(page).toHaveURL(/\/today$/);
  });

  test('demo owner sign-in lands on /today', async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.goto('/today');
    await expect(page).toHaveURL(/\/today$/);
  });

  test('the e2e outbox is not exposed on the direct server', async ({ request }) => {
    const res = await request.get('/_dev/outbox');
    expect(res.status()).toBe(404);
  });
});
