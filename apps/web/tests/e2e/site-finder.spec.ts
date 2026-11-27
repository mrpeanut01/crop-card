import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { enableFixtureClaude } from './lib/fixtureClaude';
import { provisionHelper } from './lib/freshFarm';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

// The main preview server runs with E2E_SOIL_FIXTURE=1 and E2E_NAIP_FIXTURE=1,
// so the soil survey and the aerial photo are recorded answers, and a farm
// that saved the fixture key gets a canned Claude reading. Nothing here
// reaches USDA, USGS or Anthropic.
const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;
const SHOTS = process.env.SITE_FINDER_SHOTS;

async function overflowPx(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

async function openFinder(page: Page, goal: string) {
  await page.goto('/plan/site-finder');
  const finder = page.getByTestId('site-finder');
  await expect(finder).toHaveAttribute('data-ready', 'true');
  await page.getByTestId(`goal-${goal}`).click();
  await expect(page.getByTestId('site-finder-map')).toHaveAttribute('data-ready', 'true');
  return finder;
}

test.describe('Find a spot', () => {
  test.describe.configure({ timeout: 120_000 });

  test('with no Claude key: three spots with reasons and soil, then an Area and a next step', async ({
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInNewUser(page, 'spot');
    await createOnboardedFarm(page, { growing: ['garden'] });

    await page.goto('/plan/site-finder');
    await expect(page).toHaveTitle(/Find a spot/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find a good spot to plant');
    await expect(page.getByTestId('site-finder')).toHaveAttribute('data-ready', 'true');
    await page.getByTestId('goal-herb-garden').click();
    await expect(page.getByTestId('size-width')).toHaveValue('4');
    await expect(page.getByTestId('size-length')).toHaveValue('8');

    const map = page.getByTestId('site-finder-map');
    await expect(map).toHaveAttribute('data-ready', 'true');
    const before = await page.getByTestId('box-size').textContent();
    const smaller = page.getByTestId('box-smaller');
    expect((await smaller.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await smaller.click();
    await expect(page.getByTestId('box-size')).not.toHaveText(before ?? '');
    const box = (await map.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);

    await expect(page.getByTestId('use-aerial')).toBeDisabled();
    await expect(page.getByTestId('aerial-unavailable')).toContainText(
      'Claude is not set up for this farm'
    );
    await expect(page.getByTestId('aerial-unavailable')).toContainText('still works');

    await page.getByTestId('find-spots').click();
    const results = page.getByTestId('site-finder-results');
    await expect(results).toHaveAttribute('data-provenance', 'fallback');
    await expect(page.getByTestId('site-finder-fallback')).toHaveCount(0);
    const cards = page.getByTestId('spot-card');
    await expect(cards).toHaveCount(3);
    const first = cards.first();
    await expect(first.getByTestId('spot-label')).toContainText(/Best match|Good|Worth a look/);
    await expect(first.locator('li[data-factor="sun"]')).toContainText('by a rough estimate');
    await expect(first.locator('li[data-factor="sun"] [data-provenance="fallback"]')).toBeVisible();
    await expect(first.locator('li[data-provenance="data"]').first()).toBeVisible();
    await expect(first.locator('li[data-factor="water-distance"]')).toContainText(
      'Mark your water tap on the map'
    );
    await first.getByTestId('spot-soil').locator('summary').click();
    await expect(first.getByTestId('spot-soil')).toContainText('Tankerville');

    const unchecked = page.getByTestId('site-finder-unchecked');
    await expect(unchecked).toContainText('Call 811 before you dig');
    await expect(unchecked).toContainText('No trees or buildings are drawn');
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);

    await cards.nth(2).getByTestId('spot-dismiss').click();
    await expect(cards).toHaveCount(2);

    await first.getByTestId('spot-create').click();
    await expect(first.getByTestId('spot-name')).toHaveValue('Herb garden');
    await first.getByTestId('spot-name').fill('Kitchen herbs');
    await first.getByTestId('spot-save').click();
    await expect(first.getByTestId('spot-created')).toContainText('Kitchen herbs is on your map.');
    const next = first.getByTestId('spot-next');
    await expect(next).toHaveText('Open the garden designer');
    const href = await next.getAttribute('href');
    expect(href).toMatch(/^\/plan\/areas\/[^/]+\/design/);

    const fields = (await (await page.request.get('/api/fields?kind=garden')).json()) as {
      fields: Array<{ name: string; kind: string; geometryGeojson?: string }>;
    };
    const made = fields.fields.find((f) => f.name === 'Kitchen herbs');
    expect(made?.kind).toBe('garden');
    expect(made?.geometryGeojson).toContain('Polygon');

    await next.click();
    await expect(page).toHaveURL(/\/plan\/areas\/[^/]+\/design/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Kitchen herbs');
  });

  test('with the fixture Claude and the recorded aerial photo: ai lines, things seen, add a tree', async ({
    page
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInNewUser(page, 'spotai');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await enableFixtureClaude(page);

    await openFinder(page, 'vegetable-garden');
    const aerial = page.getByTestId('use-aerial');
    await expect(aerial).toBeEnabled();
    await aerial.check();
    await page.getByTestId('find-spots').click();

    const results = page.getByTestId('site-finder-results');
    await expect(results).toHaveAttribute('data-provenance', 'ai');
    await expect(page.getByTestId('site-finder-fallback')).toHaveCount(0);
    await expect(results).toContainText('what Claude saw in the aerial photo');
    await expect(page.getByTestId('spot-card')).toHaveCount(3);
    await expect(results.locator('[data-provenance="ai"]').first()).toBeVisible();

    const seen = page.getByTestId('site-finder-seen');
    await expect(seen.getByRole('heading')).toHaveText('Things Claude saw in the photo');
    const items = seen.getByTestId('seen-item');
    await expect(items).toHaveCount(4);
    await expect(items.first()).toContainText('Tree');
    await expect(items.first()).toContainText('Placeholder tree note');
    await expect(seen).toContainText('Nothing is added to your map unless you add it');
    await expect(page.getByTestId('site-finder-unchecked')).toContainText(
      'Changes since the aerial photo was taken'
    );
    await expect(results).toContainText('USDA NAIP');

    if (SHOTS) await page.screenshot({ path: `${SHOTS}/site-finder-1280.png`, fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/site-finder-375.png`, fullPage: true });
      await page
        .getByTestId('spot-card')
        .first()
        .screenshot({ path: `${SHOTS}/spot-375.png` });
      await page.getByTestId('goal-herb-garden').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/top-375.png` });
    }

    const before = (await (await page.request.get('/api/shade-sources')).json()) as {
      shadeSources: unknown[];
    };
    expect(before.shadeSources).toHaveLength(0);
    await items.first().getByTestId('seen-add').click();
    await expect(items.first().getByTestId('seen-height')).toHaveValue('40');
    await items.first().getByTestId('seen-height').fill('55');
    await items.first().getByTestId('seen-save').click();
    await expect(items.first().getByTestId('seen-added')).toHaveText('Added to your map.');
    const after = (await (await page.request.get('/api/shade-sources')).json()) as {
      shadeSources: Array<{ kind: string; heightFt: number; geometryGeojson?: string }>;
    };
    expect(after.shadeSources).toHaveLength(1);
    expect(after.shadeSources[0]).toMatchObject({ kind: 'tree-single', heightFt: 55 });
    expect(after.shadeSources[0].geometryGeojson).toContain('Polygon');

    // The second reading the same day is over the Free plan's allowance of
    // one, so the plain result comes back with the reason.
    await page.getByTestId('find-spots').click();
    await expect(page.getByTestId('site-finder-fallback')).toBeVisible();
    await expect(results).toHaveAttribute('data-provenance', 'fallback');
    await expect(page.getByTestId('spot-card').first()).toBeVisible();
  });

  test('a helper sees what it is and is told to ask the owner', async ({ page, browser }) => {
    await signInNewUser(page, 'spotown');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const helper = await provisionHelper(page, browser);
    try {
      await helper.goto('/plan/site-finder');
      await expect(helper.getByTestId('site-finder-readonly')).toBeVisible();
      await expect(helper.getByTestId('site-finder-ask-owner')).toContainText('Ask the owner.');
      await expect(helper.getByTestId('goal-herb-garden')).toHaveCount(0);
      await expect(helper.getByTestId('find-spots')).toHaveCount(0);
      const res = await helper.request.post('/api/site-finder', {
        data: {
          goal: 'herb-garden',
          box: { minLon: -77.7142, minLat: 39.1368, maxLon: -77.7138, maxLat: 39.1372 },
          footprintFt: { width: 4, length: 8 },
          useAerial: false
        },
        headers: { origin: originOf(page) }
      });
      expect(res.status()).toBe(403);
    } finally {
      await helper.context().close();
    }
  });

  test('the plan empty state and the farm map link to it', async ({ page }) => {
    await signInNewUser(page, 'spotlink');
    await createOnboardedFarm(page);
    await page.goto('/plan?setup=skip');
    const link = page.getByTestId('plan-where-find-spot');
    if ((await link.count()) > 0) {
      await expect(link).toHaveAttribute('href', '/plan/site-finder');
      await expect(link).toContainText('Help me pick a spot');
    }
    await page.goto('/plan/farm');
    await expect(page.getByTestId('farm-find-spot')).toHaveAttribute('href', '/plan/site-finder');
  });
});

test.describe('Find a spot in Spanish', () => {
  test.use({ baseURL: MAGIC_BASE });
  test.describe.configure({ timeout: 120_000 });

  async function signInByLink(page: Page, email: string): Promise<void> {
    const outbox = async () => {
      const res = await page.request.get(
        `${MAGIC_BASE}/_dev/outbox?to=${encodeURIComponent(email)}`
      );
      return ((await res.json()) as { messages: Array<{ body: string }> }).messages;
    };
    expect((await page.request.post('/api/auth/magic-link', { data: { email } })).status()).toBe(
      200
    );
    let token = '';
    await expect
      .poll(async () => {
        const link = (await outbox()).at(-1)?.body.match(/https?:\/\/\S+\/auth\/verify\?\S+/)?.[0];
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

  test('reads in Spanish at 375px, with the soil survey out of reach', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const email = `spot-es-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, email);
    await createOnboardedFarm(page, { growing: ['garden'] });
    const locale = await page.request.post('/api/me/locale', {
      data: { locale: 'es' },
      headers: { origin: MAGIC_BASE }
    });
    expect(locale.ok()).toBe(true);

    await page.goto('/plan/site-finder');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Busca un buen lugar para sembrar'
    );
    await expect(page.getByTestId('site-finder')).toHaveAttribute('data-ready', 'true');
    await page.getByTestId('goal-herb-garden').click();
    await expect(page.getByTestId('goal-herb-garden')).toContainText('Jardín de hierbas');
    await expect(page.getByTestId('site-finder-map')).toHaveAttribute('data-ready', 'true');
    await page.getByTestId('find-spots').click();

    const cards = page.getByTestId('spot-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.first().locator('li[data-factor="sun"]')).toContainText(
      'según un cálculo aproximado'
    );
    await expect(cards.first()).toContainText('No se pudo conectar con el estudio de suelos');
    await expect(cards.first().getByTestId('spot-create')).toHaveText('Crear esta Área aquí');
    const unchecked = page.getByTestId('site-finder-unchecked');
    await expect(unchecked).toContainText('Llama al 811 antes de cavar');
    await expect(unchecked).toContainText('No se pudo conectar con el estudio de suelos del USDA');
    await expect(page.locator('body')).not.toContainText('sitefinder.');
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);
  });
});
