import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 32D (cluster D2): Animal and Flock Cards from the offline snapshot.
// A treated flock shows its HOLD on the card, members fold under it, "Pin for
// the barn" pins the lot, and a pet's card carries the vet, food and chip.

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

test.describe('Animal and Flock Cards', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a treated flock shows its HOLD, folds its members and pins for the barn; a pet card calls the vet', async ({
    page,
    context
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);

    const flock = await post<{ group: { id: string }; members: { id: string }[] }>(
      page,
      '/api/animal-groups',
      { name: 'Backyard hens', speciesId: 'chicken', headCount: 5, members: [{ name: 'Pearl' }] }
    );
    const groupId = flock.group.id;
    const henId = flock.members[0].id;
    const { animal: dog } = await post<{ animal: { id: string } }>(page, '/api/animals', {
      speciesId: 'dog',
      name: 'Biscuit',
      microchipId: '985112000123456',
      feedingNote: '2 cups twice a day'
    });

    await open(page, `/animals/${groupId}/health`);
    await page.getByRole('button', { name: 'Record a treatment or visit' }).click();
    const form = page.getByRole('form', { name: 'Record health' });
    await form.getByLabel('Wormer', { exact: true }).check();
    await form.getByRole('textbox', { name: /^Product/ }).fill('Farm store wormer');
    await form.getByLabel('How it was given').selectOption('oral');
    await form.getByLabel('As the label says', { exact: true }).check();
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

    await open(page, '/settings/farm');
    await expect(async () => {
      await page.getByRole('button', { name: 'Add a contact' }).click();
      await expect(page.getByLabel('Contact 1 name')).toBeVisible({ timeout: 1000 });
    }).toPass();
    await page.getByLabel('Contact 1 name').fill('Dr. Lee');
    await page.getByLabel('Contact 1 type').selectOption('vet');
    await page.getByLabel('Contact 1 phone').fill('540-555-0100');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByLabel('Contact 1 type')).toHaveValue('vet');

    await open(page, '/cards');
    await page.getByRole('button', { name: 'Save for offline' }).click();
    await expect(page.getByText('Saved. These cards now open on this device')).toBeVisible();
    await page.getByRole('button', { name: 'Animals', exact: true }).click();

    const flockCard = page.locator(
      `article[data-variant="compact"][data-card-key="fl_${groupId}"]`
    );
    await expect(flockCard).toBeVisible();
    await expect(flockCard).toContainText('Chicken flock');
    await expect(flockCard).toContainText('HOLD eggs: end date not known');
    await expect(flockCard).toContainText('Holds as of');
    await expect(flockCard.locator('[data-card-status="hold"]')).toBeVisible();

    const members = page.getByTestId('flock-members');
    await expect(members.locator('summary')).toHaveText('Members (1)');
    await members.locator('summary').click();
    await expect(
      members.locator(`article[data-variant="compact"][data-card-key="an_${henId}"]`)
    ).toBeVisible();
    await expect(
      page.locator(`article[data-variant="compact"][data-card-key="an_${dog.id}"]`)
    ).toBeVisible();
    await noHorizontalOverflow(page);

    const barn = page.getByTestId('pin-barn');
    const box = await barn.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await barn.click();
    await expect(barn).toHaveText('Pinned for the barn');
    await page.getByRole('button', { name: 'Pinned', exact: true }).first().click();
    await expect(
      page.locator(`article[data-variant="compact"][data-card-key="fl_${groupId}"]`)
    ).toBeVisible();
    await expect(page.getByTestId('flock-members').locator('summary')).toHaveText('Members (1)');
    await expect(
      page.locator(`article[data-variant="compact"][data-card-key="an_${dog.id}"]`)
    ).toHaveCount(0);

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Animals', exact: true }).click();
    await expect(page.getByTestId('cards-status')).toContainText('you are offline');
    await expect(
      page.locator(`article[data-variant="compact"][data-card-key="fl_${groupId}"]`)
    ).toContainText('HOLD eggs');
    await context.setOffline(false);

    await open(page, `/cards/animal/an_${dog.id}`);
    const pet = page.locator('article[data-card-kind="animal"][data-variant="screen"]');
    await expect(pet).toContainText('Biscuit');
    await expect(pet).toContainText('2 cups twice a day');
    await expect(pet).toContainText('985112000123456');
    await expect(pet).not.toContainText('HOLD');
    const call = pet.getByRole('link', { name: 'Call Dr. Lee' });
    await expect(call).toHaveAttribute('href', 'tel:5405550100');
    expect((await call.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await noHorizontalOverflow(page);

    const short = await page.request.get(`/c/fl_${groupId}`, { maxRedirects: 0 });
    expect(short.status()).toBe(302);
    expect(short.headers()['location']).toBe(`/cards/flock/fl_${groupId}`);

    await open(page, `/cards/flock/fl_${groupId}`);
    await expect(page.getByRole('button', { name: 'Pinned for the barn' })).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('the deck reads "can\'t confirm" once a care-task dose for the flock waits on this phone', async ({
    page
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const flock = await post<{ group: { id: string } }>(page, '/api/animal-groups', {
      name: 'Layers',
      speciesId: 'chicken',
      headCount: 6
    });
    const groupId = flock.group.id;

    await open(page, '/cards');
    await page.getByRole('button', { name: 'Save for offline' }).click();
    await expect(page.getByText('Saved. These cards now open on this device')).toBeVisible();
    await page.getByRole('button', { name: 'Animals', exact: true }).click();
    const card = page.locator(`article[data-variant="compact"][data-card-key="fl_${groupId}"]`);
    await expect(card).toContainText('No holds on file as of');

    await page.evaluate(async (groupId) => {
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
          id: `care-dose-${now}`,
          ownerId,
          kind: 'task',
          occurredAt: now,
          payload: {
            taskId: 'care-task-not-on-server',
            action: 'complete',
            occurredAt: now,
            healthEvent: {
              subjectType: 'group',
              subjectId: groupId,
              kind: 'deworm',
              productName: 'Wormer',
              administeredAt: now
            }
          },
          attempts: 0,
          createdAt: now
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      idb.close();
    }, groupId);

    await open(page, '/cards');
    await page.getByRole('button', { name: 'Animals', exact: true }).click();
    await expect(card).toContainText('has not synced yet');
    await expect(card).not.toContainText('No holds on file');
    await noHorizontalOverflow(page);
  });
});
