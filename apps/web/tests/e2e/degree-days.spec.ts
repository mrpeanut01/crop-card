import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';

// Phase 32E (E5): the /scout "Watch for" strip. The preview server runs with
// E2E_DEGREE_DAY_FIXTURE=1, which registers a made-up trap-catch model for
// cucurbits (eggs from 100 degree days) and answers the NCEI daily request
// with synthetic 85/65 °F days. No real pest model or weather is involved.

const DAY = 86_400_000;
const SPRAY_WORDS = /spray|insecticide|pesticide|fungicide|\bapply/i;

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function plantSquash(page: Page): Promise<void> {
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Kitchen garden',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Squash bed',
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    fieldId: field.id
  });
  await post(page, `/api/blocks/${block.id}/plantings`, {
    cropPluginId: 'butternut-squash-waltham',
    plantingDate: Date.now() - 20 * DAY
  });
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

test.describe('degree days on /scout', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a gardener sets traps, records the first catch and sees the stage', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInNewUser(page, 'dd-owner');
    await createOnboardedFarm(page);
    await plantSquash(page);

    await page.goto('/scout');
    await page.waitForLoadState('networkidle');
    const strip = page.getByTestId('watch-for');
    await expect(strip.getByRole('heading', { name: 'Watch for' })).toBeVisible();
    await expect(strip.getByText('Test trap borer')).toBeVisible();
    await expect(
      strip.getByText('Set traps. Record your first catch to start the count.')
    ).toBeVisible();

    const save = strip.getByRole('button', { name: 'Save first catch' });
    const box = await save.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);

    await strip.getByLabel('First trap catch').fill(ymd(Date.now() - 8 * DAY));
    await save.click();
    await page.waitForLoadState('networkidle');

    await expect(strip.getByText(/degree days since/)).toBeVisible();
    await expect(
      strip.getByText('Eggs on stems: Check stems near the soil line for eggs.')
    ).toBeVisible();
    await expect(strip.getByText(/Counting from your first trap catch on/)).toBeVisible();
    await expect(strip.getByText(/Base 50°F, simple average method\./)).toBeVisible();
    await expect(strip.getByRole('button', { name: 'Clear catch' })).toBeVisible();
    expect((await strip.innerText()).match(SPRAY_WORDS)).toBeNull();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const api = await page.request.get('/api/weather/degree-days?model=test-e2e-trap-borer');
    expect(api.status()).toBe(200);
    const body = (await api.json()) as {
      station: { ghcnId: string } | null;
      models: Array<{ biofix: { provenance: string }; status: { inWindow: boolean } }>;
    };
    expect(body.station?.ghcnId).toMatch(/^USW/);
    expect(body.models[0].biofix.provenance).toBe('manual');
    expect(body.models[0].status.inWindow).toBe(true);

    await strip.getByRole('button', { name: 'Clear catch' }).click();
    await page.waitForLoadState('networkidle');
    await expect(
      strip.getByText('Set traps. Record your first catch to start the count.')
    ).toBeVisible();
  });

  test('without a farm location the strip says so, and a helper can still record a catch', async ({
    page,
    browser
  }) => {
    await provisionEmptyFarm(page);
    await plantSquash(page);
    await page.goto('/scout');
    await page.waitForLoadState('networkidle');
    const strip = page.getByTestId('watch-for');
    await expect(strip.getByText('Set your farm location.')).toBeVisible();

    const helper = await provisionHelper(page, browser);
    await helper.goto('/scout');
    await helper.waitForLoadState('networkidle');
    const hStrip = helper.getByTestId('watch-for');
    await hStrip.getByLabel('First trap catch').fill(ymd(Date.now() - 3 * DAY));
    await hStrip.getByRole('button', { name: 'Save first catch' }).click();
    await helper.waitForLoadState('networkidle');
    await expect(hStrip.getByRole('button', { name: 'Clear catch' })).toBeVisible();
    await helper.context().close();
  });

  test('no strip when nothing a model watches is planted', async ({ page }) => {
    await signInNewUser(page, 'dd-none');
    await createOnboardedFarm(page);
    await page.goto('/scout');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'What did you see?' })).toBeVisible();
    await expect(page.getByTestId('watch-for')).toHaveCount(0);
  });
});
