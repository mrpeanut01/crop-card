import type { Locator, Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionWizardTenant } from './lib/wizardTenant';

// Phase 33B (B3, B-20, B-21): an owner marks a block transitioning, then
// picks a product the library does not mark as allowed for organic use on
// /fertility, /spray, /spray/insecticide and /spray/fungicide. Each page
// shows the same non-blocking organic notice before the save, the save
// still goes through, and a farm with no organic status sees none of it.

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function markTransitioning(page: Page, blockId: string): Promise<void> {
  const res = await page.request.post('/api/organic/status', {
    data: {
      subjectType: 'block',
      subjectId: blockId,
      status: 'transitioning',
      effectiveOn: '2025-04-01',
      certifier: 'OCIA'
    },
    headers: { origin: origin(page) }
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function openApplicationForm(page: Page): Promise<Locator> {
  const summary = page.getByRole('heading', { name: 'Record fertilizer application' });
  const form = page.locator('details', { has: summary });
  await expect(async () => {
    await summary.click({ timeout: 2000 });
    await expect(form.getByLabel('Source')).toBeVisible({ timeout: 1000 });
  }).toPass();
  return form.getByLabel('Source');
}

test.describe('organic input notice', () => {
  test.describe.configure({ timeout: 150_000 });

  test('fertility: a non-allowed fertilizer on a transitioning block shows the notice and still saves', async ({
    page
  }) => {
    const farm = await provisionWizardTenant(page, {
      seeds: [],
      blocks: [{ name: 'Market Bed', acres: 0.1 }]
    });
    const blockId = farm.blocks[0].id;
    await markTransitioning(page, blockId);

    await page.goto(`/fertility?block=${blockId}`);
    await page.waitForLoadState('networkidle');
    const source = await openApplicationForm(page);

    const notice = page.getByTestId('organic-input-notice');
    await source.fill('urea-46-0-0');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Urea (46-0-0)');
    await expect(notice).toContainText(
      'The library marks this product as not allowed for organic use.'
    );
    await expect(notice).toContainText('Market Bed');
    await expect(notice).toContainText('Transitioning (owner-entered, effective');
    await expect(notice).toContainText('certifier OCIA');
    await expect(notice).not.toContainText(/—/);

    await source.fill('Neighbor compost');
    await expect(notice).toContainText("This product isn't marked as allowed for organic use.");

    await source.fill('biochar');
    await expect(notice).toHaveCount(0);

    await source.fill('urea-46-0-0');
    await expect(notice).toBeVisible();
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    const history = page.locator('section.card', {
      has: page.getByRole('heading', { name: /History — applications/ })
    });
    await expect(history).toContainText('urea-46-0-0', { timeout: 20_000 });
  });

  test('spray pages: herbicide, insecticide and fungicide each show the notice for the block', async ({
    page
  }) => {
    const farm = await provisionWizardTenant(page, {
      seeds: [],
      blocks: [{ name: 'Tomato Row', acres: 0.1 }],
      existingPlanting: true
    });
    const blockId = farm.blocks[0].id;
    await markTransitioning(page, blockId);

    await page.goto(`/spray?block=${blockId}&product=glyphosate-generic`);
    await page.waitForLoadState('networkidle');
    const herb = page.getByTestId('organic-input-notice');
    await expect(herb).toBeVisible();
    await expect(herb).toContainText('Glyphosate 41%');
    await expect(herb).toContainText('Tomato Row');

    await page.goto(`/spray/insecticide?block=${blockId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('#insecticide-product').selectOption('spinosad');
    const ins = page.getByTestId('organic-input-notice');
    await expect(ins).toBeVisible();
    await expect(ins).toContainText('Spinosad');
    await expect(ins).toContainText('Tomato Row');

    await page.goto(`/spray/fungicide?block=${blockId}&product=champ-dp&product=kocide-3000-o`);
    await page.waitForLoadState('networkidle');
    const fung = page.getByTestId('organic-input-notice');
    await expect(fung).toBeVisible();
    await expect(fung).toContainText('Champ DP');
    await expect(fung).toContainText("isn't marked as allowed for organic use");
    await expect(fung).not.toContainText('Kocide');

    await page.setViewportSize({ width: 375, height: 800 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('organic-input-notice')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a farm with no organic status sees no organic notice anywhere', async ({ page }) => {
    const farm = await provisionWizardTenant(page, {
      seeds: [],
      blocks: [{ name: 'Home Bed', acres: 0.05 }],
      existingPlanting: true
    });
    const blockId = farm.blocks[0].id;

    await page.goto(`/fertility?block=${blockId}`);
    await page.waitForLoadState('networkidle');
    const source = await openApplicationForm(page);
    await source.fill('urea-46-0-0');
    await expect(source).toHaveValue('urea-46-0-0');
    await expect(page.getByTestId('organic-input-notice')).toHaveCount(0);

    await page.goto(`/spray?block=${blockId}&product=glyphosate-generic`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByTestId('organic-input-notice')).toHaveCount(0);

    await page.goto(`/spray/fungicide?block=${blockId}&product=bravo-weather-stik`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('organic-input-notice')).toHaveCount(0);
  });
});
