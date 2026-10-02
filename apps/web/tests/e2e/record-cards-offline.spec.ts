import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { reloadUnderServiceWorker } from './lib/serviceWorker';

// Phase 33D (D1): a record card opened on /records opens again with no
// signal, from /records, from /cards and from its printed /c/ link.
test.use({ serviceWorkers: 'allow' });

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

async function seedSpray(page: Page): Promise<string> {
  await provisionEmptyFarm(page);
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Back forty',
    kind: 'field',
    acres: 2
  });
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Corn 1',
    acres: 2,
    fieldId: field.id
  });
  await post(page, `/api/blocks/${block.id}/plantings`, {
    cropPluginId: 'corn',
    plantingDate: Date.now() - 20 * DAY
  });
  const { equipment } = await post<{ equipment: { id: string } }>(page, '/api/equipment', {
    type: 'sprayer',
    label: 'Backpack 4'
  });
  const { event } = await post<{ event: { id: string } }>(page, '/api/spray/record', {
    blockId: block.id,
    blockCrops: { primary: { cropPluginId: 'corn' } },
    productPluginIds: ['atrazine-4l-generic'],
    sprayer: { id: equipment.id },
    conditions: { windMph: 4, tempF: 70, rainForecastMmNext24h: 0 },
    notes: 'Waterhemp along the fence'
  });
  return event.id;
}

async function cardsDataCached(page: Page): Promise<number> {
  return page.evaluate(async () => {
    if (!(await caches.has('cropcard-tenant-cards'))) return 0;
    return (await (await caches.open('cropcard-tenant-cards')).keys()).length;
  });
}

test.describe('offline record cards (33D D1)', () => {
  test('open a spray record card, go offline, reload its /c/ link and see the saved copy', async ({
    page,
    context
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 375, height: 800 });
    const id = await seedSpray(page);

    await page.goto('/records');
    await page.waitForLoadState('networkidle');
    await reloadUnderServiceWorker(page);
    await expect.poll(() => cardsDataCached(page), { timeout: 20_000 }).toBeGreaterThan(0);

    await page
      .getByRole('button', { name: /^Card: Spray record from/ })
      .first()
      .click();
    const panel = page.getByTestId('record-card-panel').first();
    await expect(panel.locator('article[data-card-kind="spray"]')).toBeVisible();
    const pin = panel.getByTestId('record-card-pin');
    await expect(pin).toHaveText('Pin on this device');
    await pin.click();
    await expect(pin).toHaveText('Pinned on this device');
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    const box = await pin.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

    await context.setOffline(true);
    // Chromium can restart the idle service worker without the offline
    // emulation, so its own fetch of the short link is failed here too.
    await context.route(/\/c\/[^/]+$/, (route) => route.abort('internetdisconnected'));

    await page.goto(`/c/rc_spray.${id}`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(new RegExp(`/cards/record/rc_spray\\.${id}$`));
    const notice = page.getByTestId('saved-copy-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('role', 'note');
    await expect(notice).toContainText(
      /^Saved copy from .+\. The record may have changed since\.$/
    );
    await expect(page.locator('article[data-card-kind="spray"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Void this entry…' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Print/ })).toHaveCount(0);
    const savedPin = page.getByTestId('saved-record-pin');
    await expect(savedPin).toHaveText('Unpin');
    await expect(page.getByTestId('saved-record-pin-hint')).toHaveText(
      'Pinned. Kept on this device until you unpin it.'
    );
    expect((await savedPin.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await expect(page.getByRole('link', { name: 'Open the record' })).toHaveAttribute(
      'href',
      `/records/spray/${id}`
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole('link', { name: 'Back to your cards' }).click();
    await page.waitForLoadState('networkidle');
    const saved = page.getByTestId('saved-records');
    await expect(saved).toBeVisible();
    await expect(saved.getByRole('link')).toHaveCount(1);
    await expect(saved.getByRole('link').first()).toContainText('Spray · Saved');
    await expect(saved.getByRole('link').first()).toContainText('Pinned');
    await page.getByRole('button', { name: 'Pinned', exact: true }).click();
    await expect(page.getByText('Nothing pinned yet.', { exact: false })).toHaveCount(0);
    await expect(saved.getByRole('link')).toHaveCount(1);

    await page.goto(`/c/rc_spray.not-here`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('record-not-saved')).toContainText(
      'This record is not saved on this device.'
    );

    await context.unroute(/\/c\/[^/]+$/);
    await context.setOffline(false);
    await page.goto(`/c/rc_spray.${id}`);
    await expect(page).toHaveURL(new RegExp(`/records/spray/${id}$`));
  });

  test('with no signal, /records shows the saved copy of a card opened earlier', async ({
    page,
    context
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSpray(page);
    await page.goto('/records');
    await page.waitForLoadState('networkidle');

    const toggle = page.getByRole('button', { name: /^Card: Spray record from/ }).first();
    await toggle.click();
    const panel = page.getByTestId('record-card-panel').first();
    await expect(panel.getByTestId('record-card-pin')).toBeVisible();
    await expect(panel.getByTestId('saved-copy-notice')).toHaveCount(0);
    await toggle.click();
    await expect(page.getByTestId('record-card-panel')).toHaveCount(0);

    await context.setOffline(true);
    await context.route(/\/api\/records\//, (route) => route.abort('internetdisconnected'));
    await toggle.click();
    const offline = page.getByTestId('record-card-panel').first();
    await expect(offline.getByTestId('saved-copy-notice')).toContainText(
      'The record may have changed since.'
    );
    await expect(offline.locator('article[data-card-kind="spray"]')).toBeVisible();
    await expect(offline.getByRole('button', { name: 'Print card' })).toHaveCount(0);
    await expect(offline.getByRole('button', { name: 'Void this entry…' })).toHaveCount(0);
    await expect(offline.getByTestId('record-card-pin')).toHaveText('Pin on this device');
    await context.unroute(/\/api\/records\//);
    await context.setOffline(false);
  });
});
