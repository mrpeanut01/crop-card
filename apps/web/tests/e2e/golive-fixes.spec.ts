import type { Page } from '@playwright/test';
import { signInAsDemoOwner } from './lib/auth';
import { originOf } from './lib/newOwner';
import { expect, test } from './lib/test';

async function signInAs(page: Page, email: string): Promise<void> {
  const res = await page.request.post('/?/signin', {
    form: { email },
    headers: { 'x-sveltekit-action': 'true', origin: originOf(page) },
    maxRedirects: 0
  });
  const body = (await res.json()) as { location?: string };
  expect(body.location, `${email} should land on /today`).toBe('/today');
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: { origin: originOf(page) }
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as T;
}

async function gardenWithTomato(page: Page): Promise<{ areaId: string; cropId: string }> {
  const area = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: `Nudge Garden ${Date.now()}`,
    kind: 'garden',
    widthFt: 20,
    lengthFt: 30
  });
  const bed = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Bed 1',
    fieldId: area.field.id,
    kind: 'bed',
    bedStyle: 'raised',
    widthFt: 4,
    lengthFt: 8,
    xFt: 2,
    yFt: 3,
    rotationDeg: 0
  });
  const placed = await post<{ planting: { id: string } }>(
    page,
    `/api/blocks/${bed.block.id}/plantings`,
    {
      cropPluginId: 'tomato-amish-paste',
      footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 48 },
      spacingPattern: 'square'
    }
  );
  return { areaId: area.field.id, cropId: placed.planting.id };
}

test.describe('page titles', () => {
  test('/today and /plan name themselves in the browser tab', async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.goto('/today');
    await expect(page).toHaveTitle('Today · CropCard');
    await page.goto('/plan');
    await expect(page).toHaveTitle('Plan · CropCard');
  });
});

test.describe('AI allowance used up', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('Fill this bed and photo help say so and offer more AI on Grower', async ({ page }) => {
    await signInAs(page, 'capped@cropcard.local');
    await post(page, '/api/settings', { key: 'anthropic_api_key', value: 'sk-ant-e2e-capped' });
    const { areaId, cropId } = await gardenWithTomato(page);

    await page.goto(`/plan/areas/${areaId}/design?view=list`);
    await page.waitForLoadState('networkidle');
    const row = page.locator('[data-testid="list-bed"][data-bed-name="Bed 1"]');
    await row.getByRole('button', { name: /^Bed 1/ }).click();
    const sheet = row.getByTestId('bed-sheet');
    await sheet.getByRole('tab', { name: 'Plantings' }).click();
    await sheet.getByRole('button', { name: 'Fill this bed' }).click();
    const results = page.getByTestId('fill-results');
    await expect(results).toContainText("This month's AI help for your farm is used up");
    await expect(results).not.toContainText('spending cap');
    const upsell = results.getByTestId('ai-upsell');
    await expect(upsell).toHaveText('More AI on Grower');
    await expect(upsell).toHaveAttribute('href', '/settings/billing');
    expect((await upsell.boundingBox())!.height).toBeGreaterThanOrEqual(48);

    await page.goto(`/cards/planting/pl_${cropId}`);
    await page.waitForLoadState('networkidle');
    const help = page.getByTestId('photo-help');
    await help.getByRole('button', { name: 'Is it ready to pick?' }).click();
    await help.getByRole('button', { name: 'Ask' }).click();
    const answer = help.getByTestId('photo-answer');
    await expect(answer).toContainText(
      "This month's AI help for your farm is used up, so here is what the Care Guide says."
    );
    await expect(answer.getByTestId('ai-upsell')).toHaveText('More AI on Grower');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('suspended farm', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('a paused farm is told its records are still here and can open them', async ({ page }) => {
    await signInAs(page, 'paused@cropcard.local');
    await page.goto('/today');
    await expect(page).toHaveURL(/\/suspended$/);
    const card = page.getByTestId('suspended');
    await expect(card).toContainText('Your records and exports are still here');
    await expect(card).not.toContainText('support@cropcard.local');
    await expect(card.getByRole('link', { name: 'Email CropCard support' })).toHaveAttribute(
      'href',
      'mailto:hello@cropcard.io'
    );
    await expect(card.getByTestId('suspended-export')).toHaveAttribute(
      'href',
      '/api/account/export.json'
    );
    const records = card.getByTestId('suspended-records');
    expect((await records.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await records.click();
    await expect(page).toHaveURL(/\/records$/);
  });
});
