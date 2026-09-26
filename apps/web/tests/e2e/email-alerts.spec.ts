import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm } from './lib/newOwner';

// Runs on the magic-link preview (E2E_PORT + 1): it has the memory email
// transport, /_dev/outbox and ORIGIN set, like production.
const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;
const OWNER = 'owner@cropcard.local';

interface OutboxMessage {
  subject: string | null;
  body: string;
  headers: Record<string, string>;
}

async function outbox(request: APIRequestContext, to: string): Promise<OutboxMessage[]> {
  const res = await request.get(`${MAGIC_BASE}/_dev/outbox?to=${encodeURIComponent(to)}`);
  return ((await res.json()) as { messages: OutboxMessage[] }).messages;
}

async function signInByLink(page: Page, email: string): Promise<void> {
  const before = (await outbox(page.request, email)).length;
  const res = await page.request.post('/api/auth/magic-link', { data: { email } });
  expect(res.status()).toBe(200);
  let token = '';
  await expect
    .poll(async () => {
      const msgs = await outbox(page.request, email);
      if (msgs.length <= before) return '';
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
}

test.describe('email alerts are opt-in, with a working unsubscribe', () => {
  test.use({ baseURL: MAGIC_BASE });

  test('opt in, get a test email, unsubscribe signed out, turn back on', async ({ page }) => {
    // Its own owner: the seeded one shares the per-address sign-in and
    // test-email limits and its consent rows with every other spec and repeat.
    const owner = `alerts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, owner);
    await createOnboardedFarm(page, { growing: ['garden'] });
    await page.goto('/settings/notifications');

    const section = page.locator('section', { hasText: 'Email alerts' }).last();
    await expect(section.getByText('Off unless you turn them on.')).toBeVisible();
    const decon = page.getByRole('checkbox', { name: /Email me: Decon due/ });
    await expect(decon).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Send a test email' })).toHaveCount(0);

    await decon.check();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('checkbox', { name: /Email me: Decon due/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Email me: Frost tonight/ })).not.toBeChecked();

    const before = (await outbox(page.request, owner)).length;
    await page.getByRole('button', { name: 'Send a test email' }).click();
    await expect(page.getByText(`Test email sent to ${owner}.`)).toBeVisible();
    let mail: OutboxMessage | undefined;
    await expect
      .poll(async () => {
        const msgs = await outbox(page.request, owner);
        mail = msgs.length > before ? msgs.at(-1) : undefined;
        return mail?.subject ?? '';
      })
      .toContain('CropCard test email');
    expect(mail!.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const oneClick = mail!.headers['List-Unsubscribe'].slice(1, -1);
    expect(new URL(oneClick).origin).toBe(MAGIC_BASE);
    const pageLink = mail!.body.match(/https?:\/\/\S+\/unsubscribe\/\S+/)?.[0];
    expect(pageLink).toBeTruthy();

    await page.context().clearCookies();
    await page.setViewportSize({ width: 375, height: 740 });
    await page.goto(pageLink!);
    await expect(page.getByRole('heading', { name: 'Stop alert emails?' })).toBeVisible();
    await expect(page.getByText(/every alert email from/)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const unsub = page.getByRole('button', { name: 'Unsubscribe', exact: true });
    expect((await unsub.boundingBox())!.height).toBeGreaterThanOrEqual(48);

    await unsub.click();
    await expect(page.getByRole('heading', { name: "You're unsubscribed" })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Decon due' })).toBeVisible();

    await page.getByRole('button', { name: /Turn them back on/ }).click();
    await expect(page.getByRole('heading', { name: 'Emails are back on' })).toBeVisible();

    const res = await page.request.post(oneClick, {
      form: { 'List-Unsubscribe': 'One-Click' }
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true, turnedOff: ['decon-due'] });

    await page.goto(pageLink!);
    await expect(page.getByText("They're already off.")).toBeVisible();
  });

  test('a forged unsubscribe link changes nothing and says so', async ({ page }) => {
    await page.goto('/unsubscribe/u1.forged.signature');
    await expect(page.getByRole('heading', { name: "Link can't be used" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unsubscribe' })).toHaveCount(0);
  });

  test('cross-site form posts are still refused everywhere but the one-click endpoint', async ({
    page
  }) => {
    const crossSite = await page.request.post('/unsubscribe/u1.forged.signature?/unsubscribe', {
      form: { everything: '1' },
      headers: { origin: 'https://evil.example' }
    });
    expect(crossSite.status()).toBe(403);
    const noOrigin = await page.request.post('/auth/verify?/resend', {
      form: { email: OWNER }
    });
    expect(noOrigin.status()).toBe(403);
    const oneClick = await page.request.post('/api/email/unsubscribe?t=u1.forged.signature', {
      form: { 'List-Unsubscribe': 'One-Click' }
    });
    expect(oneClick.status()).toBe(400);
  });
});
