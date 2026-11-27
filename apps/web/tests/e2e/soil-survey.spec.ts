import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';
import { parseSdaTable } from '../../src/lib/soil/parse';

// The main preview server runs with E2E_SOIL_FIXTURE=1, so every soil survey
// lookup answers with the recorded Loudoun County response (no live call to
// USDA). The magic-link server has Spanish on but no fixture and weather
// feeds off, so there the survey reads "could not reach" until the spec
// answers the API itself.
const loudoun: unknown = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/lib/server/__fixtures__/sda-loudoun.json'), 'utf8')
);
const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;

function square(lat: number, lon: number): unknown {
  const d = 0.0005;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lon - d, lat - d],
        [lon + d, lat - d],
        [lon + d, lat + d],
        [lon - d, lat + d],
        [lon - d, lat - d]
      ]
    ]
  };
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: { origin: originOf(page) }
  });
  expect(res.ok(), `${url} ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function seedAreas(page: Page) {
  const drawn = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Hill garden',
    kind: 'garden',
    geometryGeojson: square(39.08, -77.7)
  });
  const drawnBed = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Hill bed',
    acres: 0.01,
    fieldId: drawn.field.id
  });
  const sketched = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Side plot',
    kind: 'field',
    acres: 0.5
  });
  const sketchedBed = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Side strip',
    acres: 0.25,
    fieldId: sketched.field.id
  });
  const barn = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Tool barn',
    kind: 'barn'
  });
  return {
    drawnAreaId: drawn.field.id,
    drawnBedId: drawnBed.block.id,
    sketchedAreaId: sketched.field.id,
    sketchedBedId: sketchedBed.block.id,
    barnId: barn.field.id
  };
}

async function overflowPx(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

test.describe('soil survey', () => {
  test.describe.configure({ timeout: 120_000 });

  test('the API answers with the recorded survey and refuses bad points', async ({
    page,
    browser
  }) => {
    await signInNewUser(page, 'soil-api');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const ids = await seedAreas(page);

    const point = await page.request.get('/api/soil/survey?lat=39.08&lon=-77.7');
    expect(point.status()).toBe(200);
    expect(point.headers()['cache-control']).toBe('private, max-age=3600');
    expect(await point.json()).toMatchObject({
      status: 'ok',
      survey: { mapUnitSymbol: '20E', drainageClass: 'well', notSoil: false }
    });
    expect((await page.request.get('/api/soil/survey?lat=95&lon=-77.7')).status()).toBe(400);
    expect((await page.request.get('/api/soil/survey?lat=39.08')).status()).toBe(400);

    expect(
      await (await page.request.get(`/api/soil/areas/${ids.drawnAreaId}`)).json()
    ).toMatchObject({ located: true, approximate: false, lookup: { status: 'ok' } });
    expect(
      await (await page.request.get(`/api/soil/areas/${ids.sketchedAreaId}`)).json()
    ).toMatchObject({ located: true, approximate: true });
    expect((await page.request.get('/api/soil/areas/not-an-area')).status()).toBe(404);

    const anon = await browser.newContext();
    const refused = await anon.request.get(`${originOf(page)}/api/soil/survey?lat=39.08&lon=-77.7`);
    expect(refused.status()).toBe(401);
    await anon.close();
  });

  test('an owner reads the survey on /fertility with the lab-test note, at phone width', async ({
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInNewUser(page, 'soil-fert');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const ids = await seedAreas(page);

    await page.goto(`/fertility?block=${ids.drawnBedId}`);
    const panel = page.getByTestId('soil-survey-panel');
    await expect(panel).toHaveAttribute('data-state', 'ok');
    await expect(
      panel.getByRole('heading', { name: 'What the soil survey says here' })
    ).toBeVisible();
    await expect(
      panel.getByText('When you have a lab soil test, go by the lab test.')
    ).toBeVisible();

    const line = (id: string) => panel.locator(`[data-soil-line="${id}"]`);
    await expect(line('name')).toContainText(
      'Tankerville and Purcellville soils, 25 to 45 percent slopes'
    );
    await expect(line('name')).toContainText('Purcellville (46%), Tankerville (42%)');
    await expect(line('texture')).toContainText('Silty clay loam');
    await expect(line('texture')).toContainText('A heavy soil with a lot of clay.');
    await expect(line('drainage')).toContainText('Well drained');
    await expect(line('slope')).toContainText('Very steep (35%)');
    await expect(line('bedrock')).toContainText('About 35 in down');
    await expect(line('ph')).toContainText('5.6 to 6.0, usually about 5.8');
    await expect(line('farmland')).toContainText('Not prime farmland');
    await expect(panel.locator('[data-soil-line] [data-provenance="data"]')).toHaveCount(
      await panel.locator('[data-soil-line]').count()
    );

    await expect(panel.locator('[data-soil-flag="steep"]')).toContainText('This ground is steep.');
    await expect(panel.getByTestId('soil-scale-note')).toContainText('mapped at a broad scale');
    await expect(panel.getByTestId('soil-lab-note')).toContainText(
      'A lab soil test tells you what is in your soil today.'
    );
    await expect(panel.getByTestId('soil-source')).toContainText('USDA NRCS Soil Survey');
    await expect(panel.getByRole('link', { name: 'Open Web Soil Survey' })).toHaveAttribute(
      'href',
      /websoilsurvey\.nrcs\.usda\.gov/
    );
    await expect(panel.getByTestId('soil-approximate')).toHaveCount(0);
    await expect(panel).not.toContainText(/\bsafe\b/i);
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);

    if (process.env.SOIL_SHOT) {
      await panel.scrollIntoViewIfNeeded();
      await panel.screenshot({ path: process.env.SOIL_SHOT });
    }

    await page.goto(`/fertility?block=${ids.sketchedBedId}`);
    const approx = page.getByTestId('soil-survey-panel');
    await expect(approx).toHaveAttribute('data-state', 'ok');
    await expect(approx.getByTestId('soil-approximate')).toHaveText(
      "This is for your farm's location. Draw this Area on the map for a closer answer."
    );
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);
  });

  test('the Area card folds the survey away until it is opened', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInNewUser(page, 'soil-area');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const ids = await seedAreas(page);

    const lookups: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/soil/')) lookups.push(r.url());
    });
    await page.goto(`/plan?field=${ids.drawnAreaId}`);
    await page.waitForLoadState('networkidle');
    // An empty season opens the planning wizard on its own.
    const wizard = page.locator('.aw-modal');
    if (await wizard.isVisible()) {
      await page.keyboard.press('Escape');
      await expect(wizard).toHaveCount(0);
    }
    const view = page.getByTestId('plan-area-view');
    const panel = view.getByTestId('soil-survey-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('soil-lines')).toBeHidden();
    expect(lookups).toEqual([]);

    await expect(async () => {
      if ((await panel.getAttribute('open')) === null) {
        await panel.locator('summary').click({ timeout: 2000 });
      }
      await expect(panel).toHaveAttribute('data-state', 'ok', { timeout: 3000 });
    }).toPass();
    await expect(panel.locator('summary')).toHaveText('Soil survey');
    await expect(panel.locator('[data-soil-line="drainage"]')).toContainText('Well drained');
    await expect(panel.getByRole('link', { name: 'Add a soil test' })).toHaveAttribute(
      'href',
      '/fertility?soilTest=1'
    );
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toContain(`/api/soil/areas/${ids.drawnAreaId}`);
    const summary = await panel.locator('summary').boundingBox();
    expect(summary?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);

    await panel.getByRole('link', { name: 'Add a soil test' }).click();
    await expect(page.getByTestId('setup-soil-test')).toBeVisible();
  });

  test('the farm settings page shows the survey for the saved location', async ({ page }) => {
    await signInNewUser(page, 'soil-farm');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await page.goto('/settings/farm');
    await page.waitForLoadState('networkidle');
    const panel = page.getByTestId('soil-survey-panel');
    await expect(async () => {
      if ((await panel.getAttribute('open')) === null) {
        await panel.locator('summary').click({ timeout: 2000 });
      }
      await expect(panel).toHaveAttribute('data-state', 'ok', { timeout: 3000 });
    }).toPass();
    await expect(panel).toContainText("This is for your farm's saved location.");
    await expect(panel.locator('[data-soil-line="texture"]')).toContainText('Silty clay loam');
  });
});

test.describe('soil survey in Spanish, and when the service cannot be reached', () => {
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

  test('says it could not reach the survey, retries, then reads in Spanish', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const email = `soil-es-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, email);
    await createOnboardedFarm(page, { growing: ['garden'] });
    const ids = await seedAreas(page);
    await post(page, '/api/me/locale', { locale: 'es' });

    await page.goto(`/fertility?block=${ids.drawnBedId}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    const panel = page.getByTestId('soil-survey-panel');
    await expect(panel).toHaveAttribute('data-state', 'unavailable');
    await expect(panel.getByRole('heading')).toHaveText('Lo que dice el estudio de suelos aquí');
    await expect(panel.getByTestId('soil-unavailable')).toContainText(
      'No se pudo conectar con el estudio de suelos. Inténtalo de nuevo más tarde.'
    );
    await expect(panel.getByTestId('soil-lines')).toHaveCount(0);

    const survey = parseSdaTable(loudoun, Date.now());
    await page.route('**/api/soil/areas/**', (route) =>
      route.fulfill({
        json: { located: true, approximate: false, lookup: { status: 'ok', survey } }
      })
    );
    const retry = panel.getByRole('button', { name: 'Intentar de nuevo' });
    expect((await retry.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await retry.click();
    await expect(panel).toHaveAttribute('data-state', 'ok');
    const line = (id: string) => panel.locator(`[data-soil-line="${id}"]`);
    await expect(line('name')).toContainText('Cómo llama el estudio a este suelo');
    await expect(line('name')).toContainText('Tankerville and Purcellville soils');
    await expect(line('texture')).toContainText('Franco arcillo limoso');
    await expect(line('texture')).toContainText('Un suelo pesado con mucha arcilla.');
    await expect(line('drainage')).toContainText('Bien drenado');
    await expect(line('slope')).toContainText('Muy empinado (35%)');
    await expect(line('farmland')).toContainText('No es tierra agrícola de primera');
    await expect(panel.locator('[data-soil-flag="steep"]')).toContainText(
      'Este terreno es empinado.'
    );
    await expect(panel.getByTestId('soil-lab-note')).toContainText(
      'Un análisis de suelo de laboratorio te dice qué hay en tu suelo hoy.'
    );
    await expect(panel).not.toContainText('Looking up');
    await expect(panel).not.toContainText(/soil\.[a-z]+\.[a-zA-Z]+/);
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);

    await page.unroute('**/api/soil/areas/**');
    await page.route('**/api/soil/areas/**', (route) =>
      route.fulfill({ json: { located: true, approximate: false, lookup: { status: 'no-data' } } })
    );
    await page.reload();
    await expect(page.getByTestId('soil-no-data')).toHaveText(
      'El estudio de suelos no tiene datos para este lugar.'
    );
  });
});
