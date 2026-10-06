import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';
import { reloadUnderServiceWorker } from './lib/serviceWorker';

// #593: the orchard panel on the Planting Card and the Area Card reads the
// saved snapshot with no signal: this year's mark with its date and the
// copy's time, that stage's windows with the bee and label lines, and no
// marking (rulings OS-1 to OS-6).
test.use({ serviceWorkers: 'allow' });

async function send<T>(page: Page, method: 'POST' | 'PUT', url: string, data: unknown) {
  const res = await page.request.fetch(url, {
    method,
    data,
    headers: { origin: originOf(page) }
  });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function savedSnapshotHasOrchard(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open('cropcard');
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('farmSnapshots')) {
            db.close();
            resolve(false);
            return;
          }
          const all = db.transaction('farmSnapshots').objectStore('farmSnapshots').getAll();
          all.onsuccess = () => {
            db.close();
            resolve(
              (all.result as { bundle?: { orchard?: unknown } }[]).some((r) => !!r.bundle?.orchard)
            );
          };
          all.onerror = () => {
            db.close();
            resolve(false);
          };
        };
      })
  );
}

test('the orchard panel shows the saved mark with no signal', async ({ page, context }) => {
  test.setTimeout(150_000);
  await signInNewUser(page, 'orchard-offline');
  await createOnboardedFarm(page, { growing: ['fields'] });
  const { field } = await send<{ field: { id: string } }>(page, 'POST', '/api/fields', {
    name: 'Back orchard',
    kind: 'orchard',
    widthFt: 60,
    lengthFt: 80
  });
  const { block } = await send<{ block: { id: string } }>(page, 'POST', '/api/blocks', {
    name: 'Row 1',
    widthFt: 20,
    lengthFt: 60,
    fieldId: field.id
  });
  const { planting } = await send<{ planting: { id: string } }>(
    page,
    'POST',
    `/api/blocks/${block.id}/plantings`,
    { cropPluginId: 'apple-gala', plantingDate: Date.UTC(2024, 3, 1) }
  );
  await send(page, 'PUT', `/api/orchard/plantings/${planting.id}/stage`, { stageId: 'pink' });

  await page.goto('/today');
  await reloadUnderServiceWorker(page);
  await expect.poll(() => savedSnapshotHasOrchard(page), { timeout: 20_000 }).toBe(true);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!(await caches.has('cropcard-tenant-cards'))) return 0;
          return (await (await caches.open('cropcard-tenant-cards')).keys()).length;
        }),
      { timeout: 20_000 }
    )
    .toBeGreaterThan(0);

  await context.setOffline(true);
  await page.goto(`/cards/planting/pl_${planting.id}`);
  const panel = page.getByTestId('orchard-panel');
  await expect(panel).toHaveAttribute('data-saved', 'true');
  await expect(panel.getByTestId('orchard-saved-mark')).toContainText('Marked Pink on');
  await expect(panel.getByTestId('orchard-saved-asof')).toContainText('Saved copy from');
  await expect(panel.getByTestId('orchard-saved-asof')).toContainText(
    'Marking a stage needs a connection.'
  );
  const bee = panel.locator('[data-window="pink-diseases"] [data-testid="bee-line"]');
  await expect(bee).toContainText('To avoid killing bees');
  await expect(bee).toHaveAttribute('data-english-only', 'safety');
  await expect(
    panel.locator('[data-window="pink-diseases"] [data-testid="label-line"]')
  ).toHaveText('Check the label.');
  await expect(panel.getByRole('button')).toHaveCount(0);

  await page.goto(`/cards/area/ar_${field.id}`);
  await expect(page.getByTestId('orchard-saved-mark')).toContainText('Marked Pink on');

  await context.setOffline(false);
});
