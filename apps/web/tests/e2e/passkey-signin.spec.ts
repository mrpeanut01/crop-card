import type { APIRequestContext, CDPSession, Page } from '@playwright/test';
import { expect, test } from './lib/test';

// Phase 38: add a passkey after an email sign-in, then sign in with it.
// Runs on the magic-link preview, which sets ORIGIN (passkeys need a
// relying party). Chromium's virtual authenticator stands in for Face ID;
// the real phone/QR flow is on the owner's device test list.

const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;

test.skip(({ browserName }) => browserName !== 'chromium', 'CDP virtual authenticator');
test.use({ baseURL: MAGIC_BASE, viewport: { width: 375, height: 800 } });

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

async function virtualAuthenticator(page: Page, transport: 'internal' | 'usb' = 'internal') {
  const client: CDPSession = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true
    }
  });
  return { client, authenticatorId };
}

async function signInByEmail(page: Page, request: APIRequestContext, email: string) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: /email me a sign-in link/i }).click();
  const code = await latestCode(request, email);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/);
}

test('add a passkey after an email sign-in, then sign in with one tap', async ({
  page,
  request
}) => {
  const { client, authenticatorId } = await virtualAuthenticator(page);
  const email = `passkey-${Date.now()}@example.test`;
  await signInByEmail(page, request, email);

  const card = page.getByTestId('add-passkey-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Only add this on your own phone or computer.');
  const add = card.getByRole('button', { name: 'Add a passkey' });
  expect((await add.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  await add.click();
  await expect(card.getByRole('status')).toHaveText(/Passkey added/);

  const { credentials } = await client.send('WebAuthn.getCredentials', { authenticatorId });
  expect(credentials).toHaveLength(1);
  expect(credentials[0].isResidentCredential).toBe(true);

  await page.context().clearCookies();
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Use a passkey' });
  await expect(button).toBeVisible();
  await expect(page.getByTestId('passkey-signin')).toContainText('Use a phone or tablet');
  await button.click();
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByTestId('add-passkey-card')).toHaveCount(0);
});

test('"Not now" hides the card for this sign-in', async ({ page, request }) => {
  await virtualAuthenticator(page);
  await signInByEmail(page, request, `passkey-later-${Date.now()}@example.test`);
  const card = page.getByTestId('add-passkey-card');
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('add-passkey-card')).toHaveCount(0);
});
