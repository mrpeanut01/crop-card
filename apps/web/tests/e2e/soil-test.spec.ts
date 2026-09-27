import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { createOnboardedFarm, originOf, signInNewUser } from './lib/newOwner';

// Phase 32A: a garden household with no soil test sees one "Add a soil
// test" nudge on /records, saves last spring's report through the setup
// sheet, and its Soil Test Card opens with no signal.

test.use({ serviceWorkers: 'allow' });

const PHONE = { width: 375, height: 800 };

async function gardenWithBed(page: Page): Promise<string> {
  await signInNewUser(page, 'soil');
  await createOnboardedFarm(page, { growing: ['garden'] });
  const headers = { origin: originOf(page) };
  const area = await page.request.post('/api/fields', {
    data: { name: 'Kitchen garden', kind: 'garden', widthFt: 20, lengthFt: 30 },
    headers
  });
  expect(area.ok(), await area.text()).toBe(true);
  const fieldId = ((await area.json()) as { field: { id: string } }).field.id;
  const bed = await page.request.post('/api/blocks', {
    data: { name: 'Bed 1', kind: 'bed', widthFt: 4, lengthFt: 8, fieldId },
    headers
  });
  expect(bed.ok(), await bed.text()).toBe(true);
  return ((await bed.json()) as { block: { id: string } }).block.id;
}

async function snapshotHas(page: Page, needle: string): Promise<boolean> {
  return page.evaluate(
    (id) =>
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
            resolve(JSON.stringify(all.result).includes(id));
          };
          all.onerror = () => {
            db.close();
            resolve(false);
          };
        };
      }),
    needle
  );
}

test.describe('soil tests', () => {
  test.describe.configure({ timeout: 150_000 });

  test('a gardener saves a soil test from the nudge and its card opens offline', async ({
    page,
    context
  }) => {
    await page.setViewportSize(PHONE);
    await gardenWithBed(page);

    await page.goto('/records');
    const nudge = page.getByTestId('soil-test-nudge');
    await expect(nudge).toBeVisible({ timeout: 20_000 });
    await expect(nudge).toHaveCount(1);
    await expect(page.getByRole('link', { name: /VDACS audit PDF/ })).toHaveCount(0);

    await nudge.getByRole('button', { name: 'Add a soil test' }).click();
    const form = page.getByTestId('setup-soil-test');
    await expect(form).toBeVisible();
    await form.getByLabel('lb per acre').check();
    await form.getByLabel('Soil pH').fill('5.8');
    await form.getByLabel('Phosphorus (P) (lb/A)').fill('30');
    await form.getByLabel('Potassium (K) (lb/A)').fill('150');
    await form.getByLabel("Lab's rating").nth(1).selectOption('high');
    await form.getByRole('button', { name: 'Save soil test' }).click();

    await expect(nudge.getByText('Soil test saved.')).toBeVisible();
    const cardLink = nudge.getByRole('link', { name: 'Open the soil card' });
    const href = (await cardLink.getAttribute('href')) ?? '';
    expect(href).toMatch(/^\/cards\/soilTest\/so_/);
    const soilId = decodeURIComponent(href.split('/so_')[1]);

    await page.goto('/today');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await expect.poll(() => snapshotHas(page, soilId), { timeout: 30_000 }).toBe(true);

    await context.setOffline(true);
    await page.goto(href);
    const card = page.locator('article[data-card-kind="soilTest"][data-variant="screen"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Bed 1');
    await expect(card).toContainText('5.8 · Moderately acid');
    await expect(card).toContainText('150 lb/A · High');
    await expect(card).toContainText("Follow your lab's recommendation");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.setOffline(false);

    await page.goto('/records');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('soil-test-nudge')).toHaveCount(0);
  });

  test('the nudge can be dismissed and stays dismissed', async ({ page }) => {
    await gardenWithBed(page);
    await page.goto('/records');
    const nudge = page.getByTestId('soil-test-nudge');
    await expect(nudge).toBeVisible({ timeout: 20_000 });
    await nudge.getByRole('button', { name: 'Not now' }).click();
    await expect(nudge).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('soil-test-nudge')).toHaveCount(0);
  });
});
