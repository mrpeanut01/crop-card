import type { Page } from '@playwright/test';
import papa from 'papaparse';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';

const DAY = 86_400_000;

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

async function seedHay(page: Page): Promise<{ lateId: string; onTimeId: string }> {
  await provisionEmptyFarm(page);
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Back hayfield',
    kind: 'field',
    acres: 6
  });
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Hay 1',
    acres: 6,
    fieldId: field.id
  });
  const cut = (mowAt: number) =>
    post<{ cutting: { id: string; recordedLate: boolean } }>(page, '/api/hay/cuttings', {
      blockId: block.id,
      cropPluginId: 'alfalfa-vernema',
      mowAt
    });
  const late = await cut(Date.now() - 3 * DAY - 10 * 60_000);
  expect(late.cutting.recordedLate).toBe(true);
  const onTime = await cut(Date.now() - 60_000);
  expect(onTime.cutting.recordedLate).toBe(false);
  return { lateId: late.cutting.id, onTimeId: onTime.cutting.id };
}

const ledgerRows = (page: Page) =>
  page.getByRole('table', { name: 'Records ledger' }).locator('tbody > tr');

test.describe('records saved after their date (32G G2)', () => {
  test('a late hay cutting is marked on /records and in the exports', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const { lateId, onTimeId } = await seedHay(page);

    await page.goto('/records');
    await page.waitForLoadState('networkidle');

    const hayRows = ledgerRows(page).filter({ hasText: 'cutting' });
    await expect(hayRows).toHaveCount(2);
    await expect(page.getByText('Saved 3 days after its date')).toHaveCount(1);
    await expect(hayRows.filter({ hasText: 'cutting 1' })).toContainText(
      'Saved 3 days after its date'
    );
    await expect(hayRows.filter({ hasText: 'cutting 2' })).not.toContainText('after its date');

    const csv = await page.request.get('/api/spray/records/export.usda.csv');
    expect(csv.ok()).toBe(true);
    const body = (await csv.text())
      .split(/\r?\n/)
      .filter((l) => !l.startsWith('#'))
      .join('\n');
    const parsed = papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
    expect((parsed.meta.fields ?? []).slice(-2)).toEqual(['recorded_late', 'days_after_date']);
    const hay = parsed.data.filter((r) => r.record_kind === 'hay');
    expect(hay.map((r) => r.recorded_late).sort()).toEqual(['no', 'yes']);
    expect(hay.find((r) => r.recorded_late === 'yes')?.days_after_date).toBe('3');

    const spray = await page.request.get('/api/spray/records/export.csv');
    const sprayText = await spray.text();
    expect(sprayText).toContain(lateId);
    expect(sprayText).toContain(onTimeId);

    const gdpr = await page.request.get('/api/account/export.json');
    const json = (await gdpr.json()) as {
      schemaVersion: string;
      hayCuttings: Array<{ id: string; recordedLate: boolean }>;
    };
    expect(json.schemaVersion).toBe('1.4.0');
    expect(json.hayCuttings.find((c) => c.id === lateId)?.recordedLate).toBe(true);
  });

  test('the marker fits at 375px', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 375, height: 800 });
    await seedHay(page);
    await page.goto('/records');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Saved 3 days after its date')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
