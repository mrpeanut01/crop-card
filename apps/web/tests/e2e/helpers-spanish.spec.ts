import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm } from './lib/newOwner';
import { es } from '../../src/lib/i18n/catalogs/es';
import { en } from '../../src/lib/i18n/catalogs/en';

// Phase 34B (#509): lib helpers and server refusals read Spanish on the
// Spanish-enabled preview (E2E_PORT + 1).
const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;
const DAY = 86_400_000;

function esText(key: keyof typeof en): string {
  const value = es[key];
  if (!value) throw new Error(`missing Spanish for ${key}`);
  return value;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
}

async function outboxBodies(request: APIRequestContext, to: string): Promise<string[]> {
  const res = await request.get(`${MAGIC_BASE}/_dev/outbox?to=${encodeURIComponent(to)}`);
  const { messages } = (await res.json()) as { messages: Array<{ body: string }> };
  return messages.map((m) => m.body);
}

async function signInByLink(page: Page, email: string): Promise<void> {
  const before = (await outboxBodies(page.request, email)).length;
  const res = await page.request.post('/api/auth/magic-link', { data: { email } });
  expect(res.status()).toBe(200);
  let token = '';
  await expect
    .poll(async () => {
      const bodies = await outboxBodies(page.request, email);
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

async function useSpanish(page: Page): Promise<void> {
  const res = await page.request.post('/api/me/locale', {
    data: { locale: 'es' },
    headers: { origin: MAGIC_BASE }
  });
  expect(res.ok()).toBe(true);
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: MAGIC_BASE } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function helperOn(owner: Page, browser: Browser): Promise<Page> {
  const email = uniqueEmail('h34b');
  const invite = await post<{ acceptUrl: string }>(owner, '/api/invites', {
    email,
    role: 'helper'
  });
  const token = invite.acceptUrl.split('/invite/')[1];
  const context = await browser.newContext({ baseURL: MAGIC_BASE, serviceWorkers: 'block' });
  const helper = await context.newPage();
  await signInByLink(helper, email);
  const accept = await helper.request.post(`/invite/${token}?/accept`, {
    form: {},
    headers: { 'x-sveltekit-action': 'true', origin: MAGIC_BASE },
    maxRedirects: 0
  });
  expect(((await accept.json()) as { location?: string }).location).toBe('/today');
  return helper;
}

test.describe('helpers read Spanish (#509)', () => {
  test.use({ baseURL: MAGIC_BASE });
  test.describe.configure({ timeout: 120_000 });

  test('a planting page shows its projected events and tasks in Spanish', async ({ page }) => {
    await signInByLink(page, uniqueEmail('crop34b'));
    await createOnboardedFarm(page, { growing: ['garden'] });
    const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
      name: 'North field',
      kind: 'field',
      acres: 3
    });
    const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: 'North 3',
      acres: 3,
      fieldId: field.id
    });
    const corn = await post<{ planting?: { id: string }; id?: string }>(
      page,
      `/api/blocks/${block.id}/plantings`,
      { cropPluginId: 'corn-sweet-bodacious', plantingDate: Date.now() - 10 * DAY }
    );
    const cropId = corn.planting?.id ?? corn.id ?? '';
    expect(cropId).not.toBe('');

    await page.goto(`/crops/${cropId}`);
    await page.waitForLoadState('networkidle');
    const projected = page.locator('section.projected');
    await expect(projected).toContainText('Expected emergence:');

    await useSpanish(page);
    await page.goto(`/crops/${cropId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(projected).toBeVisible();
    await expect(projected).not.toContainText('Expected emergence:');
    await expect(projected).not.toContainText(/\bPlant [A-Z]/);
    const emergence = esText('plan.cal.title.emergence').split('{')[0].trim();
    await expect(projected).toContainText(emergence);
  });

  test('the planter plate suggestion reads Spanish', async ({ page }) => {
    await signInByLink(page, uniqueEmail('plate34b'));
    await createOnboardedFarm(page, { growing: ['garden'] });
    await post(page, '/api/settings', { key: 'display_planter_setup', value: true });
    await useSpanish(page);
    await page.goto('/tools/planter-plate-selector?seedType=Corn');
    await page.waitForLoadState('networkidle');
    await page.getByText(esText('tools.plate.why')).click();
    await page.getByLabel(esText('tools.plate.inRow').replace('{unit}', 'in')).fill('9');
    const line = page.locator('p.rec-line span').first();
    await expect(line).toBeVisible();
    await expect(line).not.toContainText('stand');
    await expect(line).toContainText('plantas');
    await page.setViewportSize({ width: 375, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('owner-only pages refuse a helper in Spanish', async ({ page, browser }) => {
    await signInByLink(page, uniqueEmail('own34b'));
    await createOnboardedFarm(page, { growing: ['garden'] });
    const helper = await helperOn(page, browser);
    await useSpanish(helper);

    const money = await helper.goto('/finance');
    expect(money?.status()).toBe(403);
    await expect(helper.getByText(esText('finance.access.ownerOnly'))).toBeVisible();
    await expect(helper.getByText(en['finance.access.ownerOnly'])).toHaveCount(0);

    const records = await helper.goto('/settings/records');
    expect(records?.status()).toBe(403);
    await expect(helper.getByText(esText('settings.err.ownerOnly'))).toBeVisible();
    await helper.context().close();
  });
});
