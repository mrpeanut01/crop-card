import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, signInNewUser } from './lib/newOwner';

// 32F, F5. The main preview runs with production's default (English only);
// the magic-link preview (E2E_PORT + 1) runs with CROPCARD_LOCALES=en,es.
const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;

async function outboxLinks(request: APIRequestContext, to: string): Promise<string[]> {
  const res = await request.get(`${MAGIC_BASE}/_dev/outbox?to=${encodeURIComponent(to)}`);
  const { messages } = (await res.json()) as { messages: Array<{ body: string }> };
  return messages.map((m) => m.body);
}

async function signInByLink(page: Page, email: string): Promise<void> {
  const before = (await outboxLinks(page.request, email)).length;
  const res = await page.request.post('/api/auth/magic-link', { data: { email } });
  expect(res.status()).toBe(200);
  let token = '';
  await expect
    .poll(async () => {
      const bodies = await outboxLinks(page.request, email);
      if (bodies.length <= before) return '';
      const link = bodies.at(-1)?.match(/https?:\/\/\S+\/auth\/verify\?\S+/)?.[0];
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

const nav = (page: Page) => page.getByRole('navigation').first();

test.describe('language infrastructure, flag off (production default)', () => {
  test.use({ locale: 'es-MX', extraHTTPHeaders: { 'Accept-Language': 'es-MX,es;q=0.9' } });

  test('stays English with no picker even for a Spanish browser', async ({ page }) => {
    await signInNewUser(page, 'i18n-off');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Account & sign-in' })).toBeVisible();
    await expect(page.getByText('App language')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Language' })).toHaveCount(0);
    await expect(nav(page).getByRole('link', { name: 'Today' }).first()).toBeVisible();
  });
});

test.describe('language picker, flag on', () => {
  test.use({ baseURL: MAGIC_BASE });

  test('an owner switches to Spanish and back', async ({ page }) => {
    const email = `i18n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, email);
    await createOnboardedFarm(page, { growing: ['garden'] });

    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const picker = page.getByLabel('App language');
    await expect(picker).toBeVisible();
    await expect(picker.locator('option')).toHaveText(['English', 'Español']);

    const use = page.getByRole('button', { name: 'Use this language' });
    const box = await use.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

    await picker.selectOption('es');
    await Promise.all([page.waitForURL(/\/settings\/account/), use.click()]);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Idioma guardado.')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('heading', { name: 'Cuenta e inicio de sesión' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Hoy' }).first()).toBeVisible();

    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(nav(page).getByRole('link', { name: 'Hoy' }).first()).toBeVisible();

    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Idioma de la aplicación').selectOption('en');
    await Promise.all([
      page.waitForURL(/\/settings\/account/),
      page.getByRole('button', { name: 'Usar este idioma' }).click()
    ]);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Language saved.')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(nav(page).getByRole('link', { name: 'Today' }).first()).toBeVisible();
  });

  test('the header EN / ES button switches the language and sticks', async ({ page }) => {
    const email = `i18n-hdr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, email);
    await createOnboardedFarm(page, { growing: ['garden'] });
    await page.goto('/today');
    await page.waitForLoadState('networkidle');

    const toggle = page.getByRole('group', { name: 'Language' });
    await expect(toggle.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const es = toggle.getByRole('button', { name: 'Español' });
    const box = await es.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

    await Promise.all([page.waitForNavigation(), es.click()]);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(nav(page).getByRole('link', { name: 'Hoy' }).first()).toBeVisible();

    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    await expect(page.getByLabel('Idioma de la aplicación')).toHaveValue('es');

    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('group', { name: 'Idioma' }).getByRole('button', { name: 'English' }).click()
    ]);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('onboarding asks which language to use', async ({ page }) => {
    const email = `i18n-ob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, email);
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Which language should CropCard use?')).toBeVisible();
    await Promise.all([
      page.waitForNavigation(),
      page
        .locator('#main-content')
        .getByRole('group', { name: 'Language' })
        .getByRole('button', { name: 'Español' })
        .click()
    ]);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('¿En qué idioma quieres usar CropCard?')).toBeVisible();
  });

  test('a Spanish browser with no saved choice gets Spanish menus, and no sideways scroll at 375 px', async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: MAGIC_BASE,
      locale: 'es-MX',
      extraHTTPHeaders: { 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.5' },
      viewport: { width: 375, height: 800 }
    });
    const page = await context.newPage();
    await page.route(
      (url) => url.origin !== MAGIC_BASE,
      (route) => route.fulfill({ status: 204, body: '' })
    );
    const email = `i18n-es-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, email);
    await createOnboardedFarm(page, { growing: ['garden'] });
    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('heading', { name: 'Cuenta e inicio de sesión' })).toBeVisible();
    await expect(page.getByLabel('Idioma de la aplicación')).toHaveValue('es');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});
