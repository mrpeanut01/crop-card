import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { createOnboardedFarm, signInNewUser } from './lib/newOwner';

// Phase 30G integration: a /today task card and a /plan Planting card both
// lead to the Planting Card page, which carries the Care Guide, photo help
// and the planting journal.

const PHONE = { width: 375, height: 800 };

function originOf(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: { origin: originOf(page) }
  });
  expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

async function gardenWithTomato(page: Page, onboarded = false) {
  if (onboarded) {
    await signInNewUser(page, 'seams');
    await createOnboardedFarm(page, { growing: ['garden'] });
  } else {
    await provisionEmptyFarm(page);
  }
  const area = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Kitchen garden',
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  const bed = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Bed 1',
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    fieldId: area.field.id
  });
  const placed = await post<{ planting: { id: string } }>(
    page,
    `/api/blocks/${bed.block.id}/plantings`,
    { cropPluginId: 'tomato-cherokee-purple', plantingDate: Date.now() - 5 * 86_400_000 }
  );
  return { areaId: area.field.id, bedId: bed.block.id, cropId: placed.planting.id };
}

async function expectPlantingPage(page: Page, cropId: string) {
  await expect(page).toHaveURL(new RegExp(`/cards/planting/pl_${cropId}$`));
  const help = page.getByTestId('photo-help');
  await expect(help.getByRole('heading', { name: 'Ask about a photo' })).toBeVisible({
    timeout: 20_000
  });
  await expect(help.getByRole('heading', { name: 'Journal' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('cards seams', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a /today task on a planting opens its Planting Card with care and photo help', async ({
    page
  }) => {
    await page.setViewportSize(PHONE);
    const farm = await gardenWithTomato(page, true);
    const task = await post<{ task: { id: string } }>(page, '/api/tasks', {
      kind: 'primary',
      title: 'Stake the tomatoes',
      scheduledFor: Date.now(),
      cropId: farm.cropId,
      blockId: farm.bedId
    });
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    const card = page.locator(
      `[data-testid="today-deck"] .deck-card[data-task-id="${task.task.id}"]`
    );
    const link = card.getByRole('link', { name: 'Planting card, care and photo help' });
    await expect(link).toHaveAttribute('href', `/cards/planting/pl_${farm.cropId}`);
    await link.click();
    await expectPlantingPage(page, farm.cropId);
  });

  test('a /plan Planting card opens the journal and photo help', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const farm = await gardenWithTomato(page);
    await page.goto(`/plan?setup=skip&field=${farm.areaId}&block=${farm.bedId}`);
    await page.waitForLoadState('networkidle');
    const planting = page.locator('article[data-card-kind="planting"]').first();
    const link = planting.getByRole('link', { name: 'Journal and photo help' });
    await expect(link).toHaveAttribute('href', `/cards/planting/pl_${farm.cropId}`);
    await link.click();
    await expectPlantingPage(page, farm.cropId);
  });
});
