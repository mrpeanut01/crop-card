import type { Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';

// Phase 34A: an empty /plan shows one empty state. The owner gets the
// three choices plus the planning wizard; a helper gets "Ask the owner".

async function overflowX(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

async function tapTargetHeights(page: Page): Promise<number[]> {
  return page
    .getByTestId('plan-where')
    .locator('a, button')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
}

test.describe('one empty state on /plan', () => {
  test.describe.configure({ timeout: 120_000 });

  test('owner sees one card with three choices and the wizard, and it fits at 375px', async ({
    page,
    browser
  }) => {
    await provisionEmptyFarm(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/plan');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('plan-where')).toHaveCount(1);
    await expect(page.locator('[data-empty-state]')).toHaveCount(0);
    await expect(page.getByTestId('plan-helper-gate')).toHaveCount(0);

    const where = page.getByTestId('plan-where');
    await expect(where).toHaveAttribute('data-variant', 'owner');
    await expect(where.getByRole('heading', { name: 'Where will this grow?' })).toBeVisible();
    await expect(where.getByRole('link', { name: /Draw it on the map/ })).toBeVisible();
    await expect(where.getByRole('link', { name: /Sketch it by size/ })).toBeVisible();
    await expect(where.getByRole('button', { name: /Just give it a name/ })).toBeVisible();
    await expect(where.getByRole('button', { name: 'Start the planning wizard' })).toBeVisible();
    await expect(page.getByText('Prefer to lay it out yourself?')).toHaveCount(0);

    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    for (const h of await tapTargetHeights(page)) expect(h).toBeGreaterThanOrEqual(48);

    const helper = await provisionHelper(page, browser);
    await helper.setViewportSize({ width: 375, height: 812 });
    await helper.goto('/plan');
    await helper.waitForLoadState('networkidle');

    await expect(helper.getByTestId('plan-where')).toHaveCount(1);
    await expect(helper.locator('[data-empty-state]')).toHaveCount(0);
    const note = helper.getByTestId('plan-where');
    await expect(note).toHaveAttribute('data-variant', 'helper');
    await expect(note).toHaveAttribute('role', 'status');
    await expect(note.getByRole('heading', { name: 'Nothing to plan on yet.' })).toBeVisible();
    await expect(note).toContainText('Ask the owner to add where things grow.');
    await expect(note.locator('a, button')).toHaveCount(0);
    expect(await overflowX(helper)).toBeLessThanOrEqual(0);
    await helper.context().close();
  });
});
