import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

// #562: the orchard calendar UI. Guide choice per Area (OP-4), stage marks
// (OC-3), the app-owned bee and label lines (OP-8), the scouting task button
// (OC-7), Spanish by id (OP-29) and the bloom pre-fill on the insecticide
// form, which can only ever say in bloom.

// The Spanish case runs on the magic-link preview (E2E_PORT + 1), the one
// with CROPCARD_LOCALES=en,es.
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

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function plantTree(
  page: Page,
  cropPluginId: string,
  kind: 'orchard' | 'garden' = 'orchard'
): Promise<{ areaId: string; blockId: string; cropId: string }> {
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: kind === 'garden' ? 'Backyard' : 'Back orchard',
    kind,
    widthFt: 60,
    lengthFt: 80
  });
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: `Row ${cropPluginId}`,
    widthFt: 20,
    lengthFt: 60,
    fieldId: field.id
  });
  const { planting } = await post<{ planting: { id: string } }>(
    page,
    `/api/blocks/${block.id}/plantings`,
    { cropPluginId, plantingDate: Date.UTC(2024, 3, 1) }
  );
  return { areaId: field.id, blockId: block.id, cropId: planting.id };
}

// The page's buttons do nothing until it hydrates, so wait for that first.
async function openOrchard(page: Page, cropId: string): Promise<void> {
  await page.goto(`/plan/orchard/${cropId}`);
  await expect(page.getByTestId('orchard-calendar')).toHaveAttribute('data-ready', 'true');
}

test.describe('orchard calendar', () => {
  test.describe.configure({ timeout: 150_000 });

  test('a farm owner picks the commercial guide, marks pink and schedules scouting', async ({
    page
  }) => {
    await signInNewUser(page, 'orchard-owner');
    await createOnboardedFarm(page, { growing: ['fields'] });
    const apple = await plantTree(page, 'apple-gala');

    await openOrchard(page, apple.cropId);
    const guide = page.getByTestId('orchard-guide');
    await expect(guide.getByRole('heading', { name: 'Commercial orchard guide' })).toBeVisible();
    await expect(guide).toContainText('VCE 456-419');
    await expect(page.getByTestId('orchard-why')).toContainText('set up as a farm');
    await expect(page.getByText('Mark the stage when you see it.')).toBeVisible();

    await page.getByTestId('mark-pink').click();
    await expect(page.getByTestId('orchard-mark')).toContainText('Marked Pink on');
    const pink = page.locator('li.stage[data-stage="pink"]');
    await expect(pink.locator('details')).toHaveAttribute('open', '');
    const beeLine = pink.locator('[data-window="pink-diseases"] [data-testid="bee-line"]');
    await expect(beeLine).toHaveAttribute('data-english-only', 'safety');
    await expect(beeLine).toHaveAttribute('lang', 'en');
    await expect(beeLine).toContainText('To avoid killing bees');
    await expect(
      pink.locator('[data-window="pink-diseases"] [data-testid="label-line"]')
    ).toHaveText('Check the label.');
    await expect(pink.locator('[data-window="pink-traps"] [data-testid="label-line"]')).toHaveCount(
      0
    );
    await expect(pink).toContainText('Spongy moth (gypsy moth)');
    await expect(page.getByText(/degree/i)).toHaveCount(0);

    await page.getByTestId('schedule-pink-traps').click();
    await expect(page.getByTestId('orchard-status')).toHaveText('Added to today.');
    await page.getByTestId('schedule-pink-traps').click();
    await expect(page.getByTestId('orchard-status')).toHaveText('Already on your task list.');
    const tasks = await page.request.get(`/api/tasks?cropId=${apple.cropId}`);
    const list = ((await tasks.json()) as { tasks: { title: string; category?: string }[] }).tasks;
    const scout = list.filter((t) => t.title.startsWith('Scout: '));
    expect(scout).toHaveLength(1);
    expect(scout[0].title).not.toMatch(/spray/i);

    // OC-3: the mark starts the insecticide form at in bloom.
    await page.goto(`/spray/insecticide?block=${apple.blockId}`);
    await expect(page.getByTestId('pollinator-stage-mark')).toContainText('Marked Pink on');
    await expect(page.locator('input[name="bloom-status"][value="in-bloom"]')).toBeChecked();
    await expect(
      page.locator('input[name="bloom-status"][value="not-in-bloom"]')
    ).not.toBeChecked();

    // Clearing the mark goes back to the plain prompt.
    await openOrchard(page, apple.cropId);
    await page.getByRole('button', { name: 'Clear the mark' }).click();
    await expect(page.getByText('Mark the stage when you see it.')).toBeVisible();
  });

  test('a household gets the home guide, and choosing commercial needs a confirmation', async ({
    page
  }) => {
    await signInNewUser(page, 'orchard-home');
    await createOnboardedFarm(page, { growing: ['garden'] });
    const apple = await plantTree(page, 'apple-gala', 'garden');

    await openOrchard(page, apple.cropId);
    const guide = page.getByTestId('orchard-guide');
    await expect(guide.getByRole('heading', { name: 'Home grounds guide' })).toBeVisible();
    await expect(guide).toContainText('VCE 456-018');
    await expect(page.getByTestId('label-line')).toHaveCount(0);

    await page.getByLabel('Commercial orchard guide').check();
    await page.getByRole('button', { name: 'Save guide choice' }).click();
    await expect(page.getByRole('dialog')).toContainText('written for commercial orchards');
    await page.getByTestId('confirm-commercial').click();
    await expect(guide.getByRole('heading', { name: 'Commercial orchard guide' })).toBeVisible();
    await expect(page.getByTestId('orchard-why')).toContainText('The owner chose this guide');

    await page.goto('/settings/season');
    await expect(page.getByTestId('orchard-guide-choices')).toContainText('Backyard');
  });

  test('a crop with no calendar says so', async ({ page }) => {
    await signInNewUser(page, 'orchard-fig');
    await createOnboardedFarm(page, { growing: ['fields'] });
    const fig = await plantTree(page, 'fig-celeste');
    await openOrchard(page, fig.cropId);
    await expect(page.getByTestId('orchard-none')).toHaveText(
      'No seasonal calendar for this crop yet.'
    );
  });
});

test.describe('orchard calendar in Spanish (OP-29)', () => {
  test.use({ baseURL: MAGIC_BASE });
  test.describe.configure({ timeout: 150_000 });

  test('stage names, targets and the bee line', async ({ page }) => {
    const email = `orchard-es-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, email);
    await createOnboardedFarm(page, { growing: ['fields'] });
    const apple = await plantTree(page, 'apple-gala');
    await post(page, '/api/me/locale', { locale: 'es' });
    await openOrchard(page, apple.cropId);
    await expect(page.getByRole('heading', { name: 'Calendario de temporada' })).toBeVisible();
    await expect(page.locator('li.stage[data-stage="pink"] .stage-head')).toContainText(
      'Botón rosado'
    );
    await page.getByTestId('mark-bloom').click();
    const bloom = page.locator('li.stage[data-stage="bloom"]');
    await expect(bloom.locator('[data-testid="bee-line"]').first()).toContainText('bees');
    await expect(bloom).toContainText('Fuego bacteriano');
  });
});
