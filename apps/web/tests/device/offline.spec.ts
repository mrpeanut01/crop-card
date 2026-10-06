import type { Page } from '@playwright/test';
import { expect, test } from '../e2e/lib/test';
import { reloadUnderServiceWorker } from '../e2e/lib/serviceWorker';
import { signInAsDemoOwner } from '../e2e/lib/auth';
import { provisionEmptyFarm } from '../e2e/lib/freshFarm';

// Device sweep (#572): offline Cards with the real service worker. "No
// signal" is a TCP proxy in front of the server that refuses connections,
// so this does not depend on each engine's offline emulation.
const PROXY = 'http://localhost:5393';
const CONTROL = 'http://localhost:5394';
test.use({ serviceWorkers: 'allow', baseURL: PROXY });

async function signal(on: boolean): Promise<void> {
  await fetch(`${CONTROL}/${on ? 'up' : 'down'}`);
}

async function cardsDataCached(page: Page): Promise<number> {
  return page.evaluate(async () => {
    if (!(await caches.has('cropcard-tenant-cards'))) return 0;
    return (await (await caches.open('cropcard-tenant-cards')).keys()).length;
  });
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: PROXY } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

test.afterEach(async () => signal(true));

test('cards deck, a never-opened card and print media with no signal', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsDemoOwner(page);
  await page.goto('/today');
  await reloadUnderServiceWorker(page);
  await expect.poll(() => cardsDataCached(page), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.goto('/cards');
  await page.getByRole('button', { name: 'Save for offline' }).click();
  await expect(page.getByText('Saved. These cards now open on this device')).toBeVisible();

  await signal(false);
  await page.goto('/cards');
  await expect(page.getByRole('heading', { level: 1, name: 'Cards' })).toBeVisible();
  await expect(page.getByTestId('cards-status')).toContainText('Saved on this device');
  await page.getByRole('button', { name: 'Plantings', exact: true }).click();
  const links = page.locator('[data-card-kind="planting"] h3 a');
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((els) =>
    els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? '')
  );
  await page.goto(hrefs[hrefs.length - 1]);
  await expect(
    page.locator('article[data-card-kind="planting"][data-variant="screen"]')
  ).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.card-print-sheet article[data-variant="print"]')).toHaveCount(1);
  await page.emulateMedia({ media: 'screen' });

  // A printed short link for a live card resolves offline too.
  const key = hrefs[0].split('/').pop()!;
  await page.goto(`/c/${key}`);
  await expect(page).toHaveURL(/\/cards\/planting\/pl_/);
  await expect(
    page.locator('article[data-card-kind="planting"][data-variant="screen"]')
  ).toBeVisible();
});

test('a pinned record card opens from its /c/ link with no signal', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 375, height: 800 });
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
    plantingDate: Date.now() - 20 * 86_400_000
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
    conditions: { windMph: 4, tempF: 70, rainForecastMmNext24h: 0 }
  });

  await page.goto('/records');
  await reloadUnderServiceWorker(page);
  await expect.poll(() => cardsDataCached(page), { timeout: 20_000 }).toBeGreaterThan(0);
  await page
    .getByRole('button', { name: /^Card: Spray record from/ })
    .first()
    .click();
  const pin = page.getByTestId('record-card-panel').first().getByTestId('record-card-pin');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');

  await signal(false);
  await page.goto(`/c/rc_spray.${event.id}`);
  await expect(page).toHaveURL(new RegExp(`/cards/record/rc_spray\\.${event.id}$`));
  await expect(page.getByTestId('saved-copy-notice')).toBeVisible();
  await expect(page.locator('article[data-card-kind="spray"]')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
