import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 32D (cluster D3): offline recovery. On the pinned Flock Card with no
// signal, the HOLD shows before submit and the only way to save eggs is as
// discarded. A food log forced into the queue (a stale snapshot, or a hold
// made on another phone) replays into a 422 that waits on /records/pending
// with "Save as discard", which saves it once.

const PHONE = { width: 375, height: 800 };

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Test-only: puts a food log straight into this phone's queue, the way a
 *  log made before the hold reached this phone would sit there. There is no
 *  button for this in the app. */
async function forceQueuedFoodLog(page: Page, groupId: string, id: string) {
  await page.evaluate(
    async ({ groupId, id }) => {
      const ownerId = sessionStorage.getItem('cropcard.activeOwnerId');
      if (!ownerId) throw new Error('no active owner in this tab');
      const req = indexedDB.open('cropcard');
      const idb: IDBDatabase = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const now = Date.now();
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction('pendingSprayRecords', 'readwrite');
        tx.objectStore('pendingSprayRecords').put({
          id,
          ownerId,
          kind: 'animal-production',
          occurredAt: now,
          payload: {
            subjectType: 'group',
            subjectId: groupId,
            kind: 'eggs',
            quantity: 12,
            unit: 'eggs',
            use: 'food',
            occurredAt: now
          },
          attempts: 0,
          createdAt: now
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      idb.close();
    },
    { groupId, id }
  );
}

test.describe('Offline recovery', () => {
  test.describe.configure({ timeout: 180_000 });

  test('eggs from a flock on hold: HOLD before submit offline, then Save as discard saves once', async ({
    page,
    context
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);

    const flock = await post<{ group: { id: string } }>(page, '/api/animal-groups', {
      name: 'Barn hens',
      speciesId: 'chicken',
      headCount: 8
    });
    const groupId = flock.group.id;
    await post(page, '/api/animals/health/record', {
      subjectType: 'group',
      subjectId: groupId,
      kind: 'deworm',
      productName: 'Farm store wormer',
      route: 'oral',
      administeredAt: Date.now() - 60_000,
      labelUse: 'unknown'
    });

    await open(page, '/cards');
    await page.getByRole('button', { name: 'Save for offline' }).click();
    await expect(page.getByText('Saved. These cards now open on this device')).toBeVisible();

    await open(page, `/cards/flock/fl_${groupId}`);
    const actions = page.getByTestId('flock-quick-actions');
    await expect(actions).toBeVisible();

    await context.setOffline(true);
    await expect(actions.getByTestId('offline-hold-chip')).toContainText('HOLD eggs');
    await expect(actions.getByTestId('offline-hold-chip')).toContainText('As of');

    await actions.getByRole('button', { name: 'Log eggs' }).click();
    await actions.getByRole('button', { name: /Tap to type/ }).click();
    await actions.getByRole('spinbutton', { name: 'How many eggs' }).fill('12');
    const plus = actions.getByRole('button', { name: 'One more' });
    expect((await plus.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await expect(actions.getByTestId('hold-stop')).toContainText(
      "can't be kept for the table or sold"
    );
    await expect(actions.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    const discardNow = actions.getByRole('button', { name: 'Save as discard' });
    await expect(discardNow).toBeVisible();
    await actions.getByRole('radio', { name: 'For sale' }).check();
    await expect(actions.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await noHorizontalOverflow(page);

    const recordId = `e2e-forced-${Date.now()}`;
    await forceQueuedFoodLog(page, groupId, recordId);

    await context.setOffline(false);
    await open(page, '/records/pending');
    const recovery = page.getByTestId('recovery-actions');
    await expect(async () => {
      if (!(await recovery.isVisible())) {
        const sync = page.getByRole('button', { name: /^Sync now/ });
        if (await sync.isEnabled()) await sync.click();
      }
      await expect(recovery).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });

    await expect(page.getByText('Eggs, milk or weight')).toBeVisible();
    await expect(page.getByText('12 eggs, for food')).toBeVisible();
    const saveDiscard = recovery.getByRole('button', { name: 'Save as discard' });
    const box = await saveDiscard.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await expect(page.getByRole('button', { name: 'Delete from phone' })).toBeHidden();
    await noHorizontalOverflow(page);

    await saveDiscard.click();
    await expect(page.getByText('Queue is empty.')).toBeVisible();

    await open(page, `/animals/${groupId}/log`);
    const rows = page.locator('ul.rows li.row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('12 eggs');
    await expect(rows.first()).toContainText('Thrown out');
  });
});
