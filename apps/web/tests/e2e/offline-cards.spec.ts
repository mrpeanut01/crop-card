import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { signInAsDemoOwner } from './lib/auth';
import { provisionWizardTenant } from './lib/wizardTenant';

// This spec needs the real service worker: it precaches the /cards shell
// and keeps the per-Owner copy of the /cards layout data.
test.use({ serviceWorkers: 'allow' });

async function snapshotSaved(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('cropcard');
        req.onerror = () => resolve(0);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('farmSnapshots')) {
            db.close();
            resolve(0);
            return;
          }
          const count = db.transaction('farmSnapshots').objectStore('farmSnapshots').count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => {
            db.close();
            resolve(0);
          };
        };
      })
  );
}

async function cardsDataCached(page: Page): Promise<number> {
  return page.evaluate(async () => {
    if (!(await caches.has('cropcard-tenant-cards'))) return 0;
    return (await (await caches.open('cropcard-tenant-cards')).keys()).length;
  });
}

test.describe('offline Cards', () => {
  test('a card never opened online opens and prints with no signal', async ({ page, context }) => {
    await signInAsDemoOwner(page);
    await page.goto('/today');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // The first load installs the worker; the reload is the "app open" it controls.
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);

    await expect.poll(() => snapshotSaved(page), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => cardsDataCached(page), { timeout: 20_000 }).toBeGreaterThan(0);

    await context.setOffline(true);

    await page.goto('/cards');
    await expect(page.getByRole('heading', { level: 1, name: 'Cards' })).toBeVisible();
    await expect(page.getByTestId('cards-status')).toContainText('Saved on this device');
    await expect(page.getByTestId('cards-status')).toContainText('you are offline');

    await page.getByRole('button', { name: 'Plantings', exact: true }).click();
    const plantingLinks = page.locator('[data-card-kind="planting"] h3 a');
    await expect(plantingLinks.first()).toBeVisible();
    const hrefs = await plantingLinks.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? '')
    );
    expect(hrefs.length).toBeGreaterThan(0);

    const title = (await plantingLinks.first().textContent())?.trim() ?? '';
    await plantingLinks.first().click();
    await expect(page).toHaveURL(/\/cards\/planting\/pl_/);
    await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();

    // A hard navigation to a card URL this browser has never loaded.
    const target = hrefs[hrefs.length - 1];
    await page.goto(target);
    await expect(
      page.locator('article[data-card-kind="planting"][data-variant="screen"]')
    ).toBeVisible();

    await page.emulateMedia({ media: 'print' });
    const sheet = page.locator('.card-print-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('article[data-variant="print"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Print this card' })).toBeHidden();
    await page.emulateMedia({ media: 'screen' });

    await page.goto('/cards');
    await page.getByRole('button', { name: 'Spray', exact: true }).click();
    // Spray cards exist only for stocked pesticides; either way the filter
    // renders offline, and any spray card says it is a reference only.
    const spray = page.locator('[data-card-kind="spray"]');
    await expect(
      spray.or(page.getByText('Spray cards appear for pesticides you have in stock')).first()
    ).toBeVisible();
    if ((await spray.count()) > 0) {
      await expect(spray.first()).toContainText('Reference, not a clearance');
    }

    await context.setOffline(false);
  });

  test('a garden designer opened by a link with no signal renders read-only from the saved copy', async ({
    page,
    context
  }) => {
    test.setTimeout(120_000);
    await provisionWizardTenant(page, { blocks: [], seeds: [] });
    const origin =
      (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
      'http://localhost:5173';
    const post = async <T>(url: string, data: unknown): Promise<T> => {
      const res = await page.request.post(url, {
        data: data as Record<string, unknown>,
        headers: { origin }
      });
      expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
      return (await res.json()) as T;
    };
    const area = await post<{ field: { id: string } }>('/api/fields', {
      name: 'Offline Garden',
      kind: 'garden',
      widthFt: 20,
      lengthFt: 30
    });
    await post('/api/blocks', {
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

    await page.goto('/cards');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await expect.poll(() => snapshotSaved(page), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => cardsDataCached(page), { timeout: 20_000 }).toBeGreaterThan(0);

    await context.setOffline(true);
    await page.goto('/cards');
    await page.getByRole('button', { name: 'Areas', exact: true }).click();
    await page
      .locator('[data-card-kind="area"] h3 a')
      .filter({ hasText: 'Offline Garden' })
      .click();
    await expect(page).toHaveURL(/\/cards\/area\//);
    await page.getByRole('link', { name: 'Open designer' }).first().click();

    await expect(page).toHaveURL(new RegExp(`/plan/areas/${area.field.id}/design`));
    await expect(page.getByTestId('garden-designer')).toBeVisible();
    await expect(page.getByTestId('offline-banner')).toContainText(
      "You're offline. This layout is from"
    );
    await expect(page.locator('[data-testid="bed"][data-bed-name="Bed 1"]')).toBeVisible();
    await expect(page.getByTestId('preset-bar')).toHaveCount(0);
    await expect(page.getByRole('slider')).toBeVisible();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.locator('[data-testid="list-bed"][data-bed-name="Bed 1"]')).toBeVisible();

    await context.setOffline(false);
  });

  test('pinning keeps a card at the top of the deck', async ({ page }) => {
    await signInAsDemoOwner(page);
    await page.goto('/cards');
    await page.getByRole('button', { name: 'Save for offline' }).click();
    await expect(page.getByText('Saved. These cards now open on this device')).toBeVisible();

    await page.getByRole('button', { name: 'Areas', exact: true }).click();
    const firstArea = page.locator('.deck li').first();
    const name = (await firstArea.locator('h3').textContent())?.trim() ?? '';
    await firstArea.getByRole('button', { name: `Pin ${name}`, exact: true }).click();
    await expect(
      firstArea.getByRole('button', { name: `Unpin ${name}`, exact: true })
    ).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Pinned', exact: true }).click();
    await expect(page.locator('.deck li')).toHaveCount(1);
    await expect(page.locator('.deck li h3')).toHaveText(name);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Pinned', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('.deck li h3')).toHaveText(name);
    await page
      .locator('.deck li')
      .first()
      .getByRole('button', { name: `Unpin ${name}`, exact: true })
      .click();
    await page.getByRole('button', { name: 'All', exact: true }).click();
  });
});
