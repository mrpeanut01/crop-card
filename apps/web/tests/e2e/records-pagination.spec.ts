import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 375, height: 800 };
const MINUTE = 60_000;

function originOf(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function seedScouts(page: Page, count: number): Promise<void> {
  await provisionEmptyFarm(page);
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
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    await post(page, '/api/scout/record', {
      blockId: block.id,
      pest: `Pest ${String(i).padStart(2, '0')}`,
      metric: 'per_plant',
      value: 1,
      occurredAt: now - i * MINUTE
    });
  }
}

const ledgerRows = (page: Page) =>
  page.getByRole('table', { name: 'Records ledger' }).locator('tbody > tr');

test.describe('/records pagination', () => {
  test('shows the newest 50, loads more, and keeps exports on the full set', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(DESKTOP);
    await seedScouts(page, 55);

    await page.goto('/records');
    await page.waitForLoadState('networkidle');

    await expect(ledgerRows(page)).toHaveCount(50);
    await expect(ledgerRows(page).first()).toContainText('Pest 00');
    const status = page.getByRole('status').filter({ hasText: /^Showing/ });
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toContainText('Showing 50 of 55 records');
    await expect(page.locator('.count-mono')).toHaveText('55 of 55');

    const csv = page.getByRole('link', { name: /CSV/ }).first();
    await expect(csv).not.toHaveAttribute('href', /show=/);

    const more = page.getByRole('link', { name: 'Load 5 more' });
    const box = await more.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await more.click();

    await expect(page).toHaveURL(/[?&]show=100/);
    await expect(ledgerRows(page)).toHaveCount(55);
    await expect(ledgerRows(page).last()).toContainText('Pest 54');
    await expect(status).toContainText('Showing 55 of 55 records');
    await expect(page.getByRole('link', { name: /^Load \d+ more$/ })).toHaveCount(0);

    // A filter change starts again from the first page.
    await page
      .getByRole('group', { name: 'Record kind filters' })
      .getByRole('button', { name: /Scout/ })
      .click();
    await expect(page).not.toHaveURL(/show=/);
    await expect(ledgerRows(page)).toHaveCount(50);
  });

  test('the load-more control fits at 375px', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE);
    await seedScouts(page, 51);
    await page.goto('/records');
    await page.waitForLoadState('networkidle');
    const more = page.getByRole('link', { name: 'Load 1 more' });
    await expect(more).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
