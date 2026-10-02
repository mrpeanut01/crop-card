import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, signInNewUser } from './lib/newOwner';
import { en } from '../../src/lib/i18n/catalogs/en';
import { es } from '../../src/lib/i18n/catalogs/es';

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

// 34B (B34-29): English sentences that render on the swept routes for a new
// garden farm. A Spanish page that still shows one of them fails.
const KNOWN_ENGLISH_KEYS = [
  'today.gs.heading',
  'gs.bed.title',
  'planui.where.title',
  'planui.where.sketchHint',
  'plan.farm.skip',
  'plan.cal.printMonth',
  'inv.empty.lede',
  'equip.lede',
  'docs.page.uploadSub',
  'docs.copy.backupNote',
  'organic.pack.title',
  'organic.add.help',
  'forage.page.nameOne',
  'settings.helpers.noPending',
  'settings.notif.typesSub',
  'settings.farm.nothingDrawn',
  'billing.free.title',
  'wizard.year.legend',
  'settings.index.records.sub',
  'billing.plans.foreverNoCard',
  'cards.spray.why1',
  'cards.cal.sprayNotice',
  'animallib.food.unknown',
  'plan.cal.body.harvestReadiness'
] as const satisfies readonly (keyof typeof en)[];

// B34-30: built from the catalog's own top-level prefixes, so a new namespace
// is covered without editing this test.
const RAW_KEY = new RegExp(
  `\\b(?:${[...new Set(Object.keys(en).map((k) => k.split('.')[0]))].join('|')})\\.[a-z][A-Za-z0-9]*(?:\\.[A-Za-z0-9-]+)+`
);

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

  test('the known English sentences have Spanish values', () => {
    expect(KNOWN_ENGLISH_KEYS.length).toBeGreaterThanOrEqual(12);
    for (const key of KNOWN_ENGLISH_KEYS) {
      expect(en[key].split(/\s+/).length, key).toBeGreaterThan(1);
      expect(es[key], key).toBeTruthy();
      expect(es[key], key).not.toBe(en[key]);
    }
  });

  test('main pages render in Spanish with no raw message keys or known English', async ({
    page
  }) => {
    const routes = [
      '/today',
      '/plan',
      '/plan/farm',
      '/plan/calendar',
      '/inventory',
      '/equipment',
      '/records',
      '/records/organic',
      '/harvest',
      '/scout',
      '/animals',
      '/cards',
      '/fertility',
      '/forage',
      '/finance',
      '/plugins',
      '/tools',
      '/settings',
      '/settings/farm',
      '/settings/billing',
      '/settings/helpers',
      '/settings/notifications',
      '/settings/season',
      '/settings/documents',
      '/settings/records',
      '/settings/equipment'
    ];
    // B34-31: one sign-in, one farm, and time for every route under load.
    test.setTimeout(60_000 + routes.length * 10_000);
    const email = `i18n-all-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, email);
    await createOnboardedFarm(page, { growing: ['garden'] });
    await page.goto('/settings/account');
    await page.getByLabel('App language').selectOption('es');
    await Promise.all([
      page.waitForURL(/\/settings\/account/),
      page.getByRole('button', { name: 'Use this language' }).click()
    ]);
    const english = KNOWN_ENGLISH_KEYS.map((key) => ({ key, text: en[key] }));
    for (const route of routes) {
      await test.step(route, async () => {
        const res = await page.goto(route);
        // /forage with no subject answers 400 by design; anything under 500 renders a page.
        expect(res?.status(), route).toBeLessThan(500);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('html'), route).toHaveAttribute('lang', 'es');
        const text = await page.locator('body').innerText();
        expect(text.match(RAW_KEY)?.[0] ?? null, `${route} shows a raw message key`).toBeNull();
        const found = english.filter((e) => text.includes(e.text)).map((e) => e.key);
        expect(found, `${route} shows English`).toEqual([]);
      });
    }
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

  test('the SMS consent line stays the registered English with a Spanish line below it', async ({
    browser
  }) => {
    const context = await browser.newContext({
      baseURL: MAGIC_BASE,
      locale: 'es-MX',
      extraHTTPHeaders: { 'Accept-Language': 'es-MX,es;q=0.9' },
      viewport: { width: 375, height: 800 }
    });
    const page = await context.newPage();
    await page.goto('/?via=phone');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    const registered = page.locator('p.consent[data-english-only="regulatory"]');
    await expect(registered).toHaveAttribute('lang', 'en');
    await expect(registered).toHaveText(
      'CropCard will text you a sign-in code. Msg & data rates may apply. Reply STOP to opt out, HELP for help.'
    );
    const spanish = page.getByTestId('sms-consent-translation');
    await expect(spanish).toHaveText(es['entry.land.smsConsentTranslation'] as string);
    await expect(spanish).toContainText('STOP');
    await expect(spanish).toContainText('HELP');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();

    const englishContext = await browser.newContext({ baseURL: MAGIC_BASE, locale: 'en-US' });
    const englishPage = await englishContext.newPage();
    await englishPage.goto('/?via=phone');
    await englishPage.waitForLoadState('networkidle');
    await expect(englishPage.locator('p.consent[data-english-only="regulatory"]')).toBeVisible();
    await expect(englishPage.getByTestId('sms-consent-translation')).toHaveCount(0);
    await englishContext.close();
  });

  test('screens translated in 34B fit 375 px in Spanish', async ({ browser }) => {
    const routes = ['/records', '/settings/records', '/settings', '/equipment', '/plan', '/today'];
    test.setTimeout(60_000 + routes.length * 10_000);
    const context = await browser.newContext({
      baseURL: MAGIC_BASE,
      locale: 'es-MX',
      extraHTTPHeaders: { 'Accept-Language': 'es-MX,es;q=0.9' },
      viewport: { width: 375, height: 800 }
    });
    const page = await context.newPage();
    await page.route(
      (url) => url.origin !== MAGIC_BASE,
      (route) => route.fulfill({ status: 204, body: '' })
    );
    const email = `i18n-375-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, email);
    await createOnboardedFarm(page, { growing: ['garden'] });
    for (const route of routes) {
      await test.step(route, async () => {
        const res = await page.goto(route);
        expect(res?.status(), route).toBeLessThan(500);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('html'), route).toHaveAttribute('lang', 'es');
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `${route} scrolls sideways`).toBeLessThanOrEqual(0);
      });
    }
    await page.goto('/settings/records');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('quiet-compliance').locator('summary').click();
    await expect(page.getByText(es['settings.records.measuredFrom'] as string)).toBeVisible();
    await expect(page.getByText(en['settings.records.measuredFrom'])).toHaveCount(0);
    await context.close();
  });
});
