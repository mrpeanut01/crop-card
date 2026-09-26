import { expect, type Browser, type Page } from '@playwright/test';

function originOf(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
}

async function signInNewUser(page: Page, email: string): Promise<void> {
  const res = await page.request.post('/?/signin', {
    form: { email },
    headers: { 'x-sveltekit-action': 'true', origin: originOf(page) },
    maxRedirects: 0
  });
  const body = (await res.json()) as { location?: string };
  expect(body.location, 'a brand-new user should land on onboarding').toBe('/onboarding');
}

/** A brand-new owner whose farm has nothing on it yet: no blocks, no
 *  plantings, no equipment and no stock. */
export async function provisionEmptyFarm(page: Page): Promise<{ email: string }> {
  const email = uniqueEmail('setup');
  await signInNewUser(page, email);
  const onboard = await page.request.post('/onboarding?/farm', {
    form: { farmName: `Empty Farm ${Date.now()}`, planningYear: String(new Date().getFullYear()) },
    headers: { 'x-sveltekit-action': 'true', origin: originOf(page) },
    maxRedirects: 0
  });
  const onboardBody = (await onboard.json()) as { type?: string };
  expect(onboardBody.type, 'onboarding should create the farm').toBe('redirect');
  return { email };
}

/** Invites a helper to the owner's farm and signs them in, in a separate
 *  browser context, with that farm active. */
export async function provisionHelper(ownerPage: Page, browser: Browser): Promise<Page> {
  const email = uniqueEmail('helper');
  const origin = originOf(ownerPage);
  const invite = await ownerPage.request.post('/api/invites', {
    data: { email, role: 'helper' },
    headers: { origin }
  });
  expect(invite.ok(), await invite.text()).toBe(true);
  const { acceptUrl } = (await invite.json()) as { acceptUrl: string };
  const token = acceptUrl.split('/invite/')[1];

  const context = await browser.newContext({ baseURL: origin, serviceWorkers: 'block' });
  const helper = await context.newPage();
  await helper.route(
    (url) => url.origin !== new URL(origin).origin && url.protocol.startsWith('http'),
    (route) => route.fulfill({ status: 204, body: '' })
  );
  await signInNewUser(helper, email);
  const accept = await helper.request.post(`/invite/${token}?/accept`, {
    form: {},
    headers: { 'x-sveltekit-action': 'true', origin },
    maxRedirects: 0
  });
  const acceptBody = (await accept.json()) as { type?: string; location?: string };
  expect(acceptBody.location, JSON.stringify(acceptBody)).toBe('/today');
  return helper;
}
