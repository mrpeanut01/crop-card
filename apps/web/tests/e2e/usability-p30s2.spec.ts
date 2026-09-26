import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { signInAsDemoOwner } from './lib/auth';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

// Phase 30 sprint 2 persona findings: each test pins one fix.

async function post(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return res.json();
}

test.describe('persona usability fixes', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a helper sees "ask the owner" on decon, block edits and the farm map editor', async ({
    page,
    browser
  }) => {
    await provisionEmptyFarm(page);
    const { block } = (await post(page, '/api/blocks', { name: 'North 10', acres: 2 })) as {
      block: { id: string };
    };
    await post(page, '/api/equipment', { type: 'sprayer', label: 'Pull 50' });
    const helper = await provisionHelper(page, browser);

    await helper.goto('/spray/decon');
    await expect(helper.getByTestId('decon-ask-owner')).toContainText('ask the owner');
    await expect(helper.getByText('Mark sprayer clean now')).toHaveCount(0);

    await helper.goto(`/plan?block=${block.id}&setup=skip`);
    await helper.waitForLoadState('networkidle');
    await expect(helper.getByTestId('plan-ask-owner').first()).toBeVisible();
    await expect(helper.getByRole('button', { name: /Edit block/ })).toHaveCount(0);
    await expect(helper.getByRole('button', { name: 'New block' })).toHaveCount(0);

    await helper.goto('/settings/farm/map');
    const refused = helper.getByTestId('farm-map-owner-only');
    await expect(refused).toBeVisible();
    await expect(refused.getByRole('link', { name: 'Open the Farm Map Card' })).toHaveAttribute(
      'href',
      '/plan/farm-map'
    );
    await helper.context().close();
  });

  test('"Plan a crop here" on an empty Area plants the whole Area as one bed', async ({ page }) => {
    await provisionEmptyFarm(page);
    const { field } = (await post(page, '/api/fields', { name: 'Hayfield', kind: 'pasture' })) as {
      field: { id: string };
    };
    await page.goto(`/plan?area=${field.id}`);
    await page.waitForLoadState('networkidle');
    const where = page.getByTestId('plan-where');
    await expect(
      where.getByRole('heading', { name: 'Where in Hayfield will this grow?' })
    ).toBeVisible();
    await where.getByRole('button', { name: /Plant the whole Hayfield as one bed/ }).click();
    await expect(page).toHaveURL(/\/plan\?block=/);
    await expect(page.getByRole('heading', { name: 'Hayfield' }).first()).toBeVisible();
  });

  test('/harvest records a crop with no harvest window and can add more once plantings exist', async ({
    page
  }) => {
    await provisionEmptyFarm(page);
    const { block } = (await post(page, '/api/blocks', { name: 'Orchard row' })) as {
      block: { id: string };
    };
    await post(page, `/api/blocks/${block.id}/plantings`, {
      cropPluginId: 'apple-orchard',
      plantingDate: Date.now() - 400 * 86_400_000
    });
    await page.goto('/harvest');
    await page.waitForLoadState('networkidle');
    const planting = page.locator('li.planting', { hasText: 'Orchard row' });
    await expect(planting.getByTestId('no-window-banner')).toContainText('Record anyway');
    await planting.getByRole('button', { name: 'Record harvest' }).click();
    await expect(planting.locator('.renderer-mount')).toBeVisible();
    await page.getByRole('button', { name: "+ Add something else you're picking" }).click();
    await expect(page.getByRole('dialog', { name: 'What are you picking?' })).toBeVisible();
  });

  test('/spray herbicides can be searched and contact organics show no HRAC group', async ({
    page
  }) => {
    await signInAsDemoOwner(page);
    await page.goto('/spray');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Find a product').fill('nonanoate');
    const cards = page.locator('[data-herbicide-id]');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('contact, no HRAC group');
    await expect(page.locator('[data-herbicide-id="ct-test-herbicide-clickthrough"]')).toHaveCount(
      0
    );
  });

  test('at phone width the bottom bar keeps five 48px tabs and folds the rest into More', async ({
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await signInAsDemoOwner(page);
    await page.goto('/today');
    await page.waitForLoadState('networkidle');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const visible = nav.locator('a.nav-link:visible, summary.nav-link:visible');
    await expect(visible).toHaveCount(6);
    for (const box of await visible.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect())
    )) {
      expect(box.width).toBeGreaterThanOrEqual(48);
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
    await expect(nav.getByRole('link', { name: 'Inventory' }).first()).toBeHidden();
    await nav.getByLabel('More pages').click();
    await expect(nav.locator('.more-link', { hasText: 'Inventory' })).toBeVisible();

    const seg = page.getByRole('tab', { name: 'Week' });
    const segBox = await seg.boundingBox();
    expect(segBox?.height ?? 0).toBeGreaterThanOrEqual(48);
  });

  test('a garden household can skip the planning assistant from a plain explainer', async ({
    page
  }) => {
    await signInNewUser(page, 'assistant');
    await createOnboardedFarm(page, { growing: ['garden'] });
    await page.goto('/today');
    const item = page.getByTestId('getting-started').locator('[data-item="assistant"]');
    await expect(item.getByRole('link')).toHaveAttribute('href', '/settings/ai/about');
    await page.goto('/settings/ai/about');
    await expect(page.getByTestId('assistant-about')).toContainText('works without it');
    await page.getByRole('button', { name: 'Skip, everything works without it' }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(item).toContainText('(done)');

    await page.goto('/records');
    await expect(page.getByTestId('records-pesticide-fold')).toBeVisible();
    await expect(page.getByRole('link', { name: /VDACS audit PDF/ })).toBeHidden();
  });
});
