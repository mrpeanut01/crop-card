import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;

const tip = (page: Page) => page.getByTestId('beginner-tip');

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Screen 1 through the real form, answering the first-time question. */
async function onboardThroughForm(
  page: Page,
  context: BrowserContext,
  answer: 'yes' | 'no'
): Promise<void> {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 39.137, longitude: -77.714 });
  await page.goto('/onboarding');
  await page.waitForLoadState('networkidle');

  const question = page.getByRole('group', { name: 'Is this your first time growing?' });
  const yes = question.getByRole('radio', { name: 'Yes, show me tips as I go' });
  const no = question.getByRole('radio', { name: 'No, I have done this before' });
  await expect(yes).toBeChecked();
  for (const label of await question.locator('label').all()) {
    expect((await label.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
  if (answer === 'no') {
    await question.getByText('No, I have done this before').click();
    await expect(no).toBeChecked();
  }

  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByTestId('frost-lastFrost')).not.toHaveText('None on record');
  const cont = page.getByRole('button', { name: /^Continue/ });
  await expect(cont).toBeEnabled();
  await cont.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are you growing on?');
  await page.getByText('A garden', { exact: true }).click();
  await page.getByRole('button', { name: /Take me to Today/ }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 15_000 });
}

async function dismiss(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/me/hints') && r.request().method() === 'POST'
  );
  await tip(page).getByRole('button', { name: 'Got it' }).click();
  await saved;
  await expect(tip(page)).toHaveCount(0);
}

test.describe('beginner tips', () => {
  test('a first-time grower gets a tip on each screen, once', async ({ page, context }) => {
    await signInNewUser(page, 'tips-yes');
    await onboardThroughForm(page, context, 'yes');

    await expect(tip(page)).toBeVisible();
    await expect(tip(page)).toHaveAttribute('data-tip', 'tip_today');
    await expect(tip(page)).toContainText('New here?');
    await expect(tip(page)).toContainText('Your jobs for today');
    await expect(tip(page).getByRole('link', { name: 'How to start' })).toHaveAttribute(
      'href',
      '/start'
    );
    await expect(tip(page).getByRole('link', { name: 'Plan what to grow' })).toHaveAttribute(
      'href',
      '/plan'
    );
    const gotIt = tip(page).getByRole('button', { name: 'Got it' });
    expect((await gotIt.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);

    const start = page.getByTestId('getting-started').locator('[data-item="start"]');
    await expect(start).toContainText('Read how to start');
    await expect(start.getByRole('link')).toHaveAttribute('href', '/start');

    await dismiss(page);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('getting-started')).toBeVisible();
    await expect(tip(page)).toHaveCount(0);

    await page.goto('/plan');
    await page.waitForLoadState('networkidle');
    await expect(tip(page)).toHaveAttribute('data-tip', 'tip_plan');
    await expect(tip(page)).toContainText('Plan what you will grow');

    await page.goto('/spray');
    await page.waitForLoadState('networkidle');
    await expect(tip(page)).toHaveAttribute('data-tip', 'tip_spray');
    await expect(tip(page)).toContainText('Always read and follow the product label.');

    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    await expect(tip(page)).toHaveCount(0);
    const setting = page.getByTestId('beginner-tips-setting');
    const toggle = setting.getByRole('switch', { name: 'Show tips for new growers' });
    await expect(toggle).toBeChecked();
    expect((await setting.locator('label').boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);

    await setting.locator('label').click();
    await expect(setting.getByText('Tips are off.')).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await page.goto('/plan');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(tip(page)).toHaveCount(0);
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('getting-started')).toBeVisible();
    await expect(page.getByTestId('getting-started').locator('[data-item="start"]')).toHaveCount(0);
    await expect(tip(page)).toHaveCount(0);

    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('beginner-tips-setting').locator('label').click();
    await expect(page.getByText('Tips are on.')).toBeVisible();
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('getting-started')).toBeVisible();
    await expect(tip(page)).toHaveCount(0);

    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Show all tips again' }).click();
    await expect(page.getByText('Every tip will show once more.')).toBeVisible();
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await expect(tip(page)).toHaveAttribute('data-tip', 'tip_today');
  });

  test('a grower who has done this before sees no tips', async ({ page, context }) => {
    await signInNewUser(page, 'tips-no');
    await onboardThroughForm(page, context, 'no');
    await expect(page.getByTestId('getting-started')).toBeVisible();
    await expect(page.getByTestId('getting-started').locator('[data-item="start"]')).toHaveCount(0);
    for (const path of ['/today', '/plan', '/spray', '/inventory', '/records']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(tip(page)).toHaveCount(0);
    }
    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('switch', { name: 'Show tips for new growers' })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Show all tips again' })).toBeDisabled();
  });

  test('a farm made without the question keeps tips off', async ({ page }) => {
    await signInNewUser(page, 'tips-unasked');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('getting-started')).toBeVisible();
    await expect(tip(page)).toHaveCount(0);
  });

  test('every main screen has its tip and none overflows a phone', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 375, height: 760 });
    await signInNewUser(page, 'tips-sweep');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const res = await page.request.post('/api/me/beginner-tips', {
      data: { enabled: true },
      headers: { origin: originOf(page) }
    });
    expect(res.status()).toBe(200);

    const screens: Array<[string, string]> = [
      ['/today', 'tip_today'],
      ['/plan', 'tip_plan'],
      ['/plan/farm', 'tip_farm_map'],
      ['/settings/farm/map', 'tip_farm_map'],
      ['/spray', 'tip_spray'],
      ['/scout', 'tip_scout'],
      ['/harvest', 'tip_harvest'],
      ['/inventory', 'tip_inventory'],
      ['/equipment', 'tip_equipment'],
      ['/calibrate', 'tip_calibrate'],
      ['/records', 'tip_records'],
      ['/cards', 'tip_cards'],
      ['/fertility', 'tip_fertility'],
      ['/animals', 'tip_animals'],
      ['/plan/calendar', 'tip_calendar']
    ];
    for (const [path, key] of screens) {
      await test.step(path, async () => {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expect(tip(page)).toHaveAttribute('data-tip', key);
        await expect(tip(page)).toHaveCount(1);
        const text = (await tip(page).textContent()) ?? '';
        expect(text).not.toMatch(/\d|[–—]|\bsafe/i);
        await expectNoOverflow(page);
      });
    }

    const areas = (await (await page.request.get('/api/fields')).json()) as
      { fields?: Array<{ id: string; kind: string }> } | Array<{ id: string; kind: string }>;
    const garden = (Array.isArray(areas) ? areas : (areas.fields ?? [])).find(
      (a) => a.kind === 'garden'
    );
    expect(garden).toBeTruthy();
    await page.goto(`/plan/areas/${garden!.id}/design`);
    await page.waitForLoadState('networkidle');
    await expect(tip(page)).toHaveAttribute('data-tip', 'tip_designer');
    await expectNoOverflow(page);

    if (process.env.TIP_SHOTS) {
      for (const path of ['/today', '/spray']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await page.screenshot({
          path: `${process.env.TIP_SHOTS}/tip${path.replace(/\//g, '-')}-375.png`
        });
      }
    }
  });
});

async function signInByLink(page: Page, request: APIRequestContext, email: string): Promise<void> {
  const outbox = async () => {
    const res = await request.get(`${MAGIC_BASE}/_dev/outbox?to=${encodeURIComponent(email)}`);
    return ((await res.json()) as { messages: Array<{ body: string }> }).messages;
  };
  const before = (await outbox()).length;
  expect((await page.request.post('/api/auth/magic-link', { data: { email } })).status()).toBe(200);
  let token = '';
  await expect
    .poll(async () => {
      const bodies = await outbox();
      if (bodies.length <= before) return '';
      const link = bodies.at(-1)?.body.match(/https?:\/\/\S+\/auth\/verify\?\S+/)?.[0];
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

test.describe('beginner tips in Spanish', () => {
  test.use({ baseURL: MAGIC_BASE });

  test('the tip, the question and the switch read in Spanish', async ({ page }) => {
    const email = `tips-es-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, page.request, email);
    const locale = await page.request.post('/api/me/locale', {
      data: { locale: 'es' },
      headers: { origin: MAGIC_BASE }
    });
    expect(locale.ok()).toBe(true);

    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    const question = page.getByRole('group', { name: '¿Es la primera vez que cultivas?' });
    await expect(
      question.getByRole('radio', { name: 'Sí, muéstrame consejos sobre la marcha' })
    ).toBeChecked();
    await expect(question.getByText('No, ya lo he hecho antes')).toBeVisible();

    const headers = { 'x-sveltekit-action': 'true', origin: MAGIC_BASE };
    const farm = await page.request.post('/onboarding?/farm', {
      form: { farmName: 'Huerto E2E', lat: '39.137', lon: '-77.714', firstTime: 'yes' },
      headers,
      maxRedirects: 0
    });
    expect(((await farm.json()) as { location?: string }).location).toBe('/onboarding');
    const growing = await page.request.post('/onboarding?/growing', {
      form: { growing: 'garden' },
      headers,
      maxRedirects: 0
    });
    expect(((await growing.json()) as { location?: string }).location).toBe('/today');

    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    await expect(tip(page)).toContainText('¿Primera vez aquí?');
    await expect(tip(page)).toContainText('Tus tareas de hoy');
    await expect(tip(page).getByRole('link', { name: 'Cómo empezar' })).toBeVisible();
    await expect(tip(page).getByRole('button', { name: 'Entendido' })).toBeVisible();
    await expect(page.getByTestId('getting-started').locator('[data-item="start"]')).toContainText(
      'Lee cómo empezar'
    );

    await page.goto('/spray');
    await page.waitForLoadState('networkidle');
    await expect(tip(page)).toContainText('Lee y sigue siempre la etiqueta del producto.');

    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('switch', { name: 'Mostrar consejos para quienes empiezan' })
    ).toBeChecked();
    await expect(
      page.getByRole('button', { name: 'Mostrar todos los consejos otra vez' })
    ).toBeVisible();
  });
});
