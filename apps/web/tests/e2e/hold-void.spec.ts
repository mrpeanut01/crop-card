import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 32G (G4): the owner voids a fungicide, an eggs log, a status
// change and a hay cutting entered by mistake, through the page each one is
// managed on.

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

async function panelFits(page: Page) {
  const right = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid="hold-void"], [data-testid="hold-void"] *');
    return Math.max(...Array.from(els).map((el) => el.getBoundingClientRect().right));
  });
  expect(right).toBeLessThanOrEqual(PHONE.width);
}

async function startVoid(scope: ReturnType<Page['getByTestId']>, reason: string) {
  await scope.getByRole('button', { name: 'Void this entry…' }).click();
  await scope.getByLabel('Why is this entry being voided?').fill(reason);
  await scope.getByRole('button', { name: 'Void this entry', exact: true }).click();
}

async function flockWithHen(page: Page) {
  const out = await post<{ group: { id: string }; members: { id: string }[] }>(
    page,
    '/api/animal-groups',
    { name: 'Backyard hens', speciesId: 'chicken', headCount: 4, members: [{ name: 'Pearl' }] }
  );
  return { groupId: out.group.id, henId: out.members[0].id };
}

test.describe('owner voids (32G G4)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a fungicide on /records shows the holds it would shorten, then voids on confirm', async ({
    page,
    browser
  }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const { field: pasture } = await post<{ field: { id: string } }>(page, '/api/fields', {
      name: 'North pasture',
      kind: 'pasture',
      acres: 2
    });
    const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: 'Paddock 1',
      acres: 2,
      fieldId: pasture.id
    });
    const { event } = await post<{ event: { id: string } }>(page, '/api/fungicide/record', {
      blockId: block.id,
      productPluginIds: ['champ-dp'],
      conditions: { windMph: 4, tempF: 70, rainForecastMmNext24h: 0 }
    });

    const helper = await provisionHelper(page, browser);
    await helper.setViewportSize(PHONE);
    await open(helper, '/records');
    await helper.getByRole('button', { name: /^Card: Fungicide record/ }).click();
    await expect(helper.getByRole('button', { name: 'Print card' })).toBeVisible();
    await expect(helper.getByRole('button', { name: 'Void this entry…' })).toHaveCount(0);
    await helper.context().close();

    await open(page, '/records');
    await page.getByRole('button', { name: /^Card: Fungicide record/ }).click();
    const panel = page.getByTestId('hold-void');
    await expect(panel).toContainText('re-entry and pre-harvest intervals');
    await startVoid(panel, 'Wrong paddock');
    await expect(panel.getByRole('alert')).toContainText(
      "Holds from a prohibited drug or unknown label can't be shortened."
    );

    await post(page, '/api/animals/grazing-attestations', {
      fieldId: pasture.id,
      reason: 'Read from the label',
      items: [
        {
          sprayEventRef: `fungicide:${event.id}`,
          productPluginId: 'champ-dp',
          grazeDays: 3,
          hayDays: 3,
          lactatingGrazeDays: 3,
          meatRemovalDays: 0
        }
      ]
    });
    await panel.getByRole('button', { name: 'Void this entry', exact: true }).click();
    await expect(panel.getByText('Voiding this entry would shorten holds:')).toBeVisible();
    await expect(panel.getByRole('alert')).toContainText('North pasture');
    await noHorizontalOverflow(page);
    await panel.getByRole('button', { name: 'Void it and shorten these holds' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Voided.' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Card: Fungicide record/ })).toHaveCount(0);
    await noHorizontalOverflow(page);
  });

  test('an eggs log and a status change are voided on the animal pages', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const { groupId, henId } = await flockWithHen(page);
    await post(page, '/api/animals/production/record', {
      subjectType: 'group',
      subjectId: groupId,
      kind: 'eggs',
      quantity: 7,
      unit: 'eggs',
      use: 'food'
    });

    await open(page, `/animals/${groupId}/log`);
    await expect(page.getByText('7 eggs')).toBeVisible();
    await startVoid(page.getByTestId('hold-void').first(), 'Counted twice');
    await expect(page.getByTestId('log-status')).toContainText('Voided.');
    await expect(page.getByText('7 eggs')).toHaveCount(0);
    await noHorizontalOverflow(page);

    await post(page, '/api/animals/status', {
      subjectType: 'animal',
      subjectId: henId,
      status: 'died',
      reason: 'Fox'
    });
    await open(page, `/animals/${henId}`);
    const history = page.getByRole('region', { name: 'History' });
    await expect(history).toContainText('Died');
    await startVoid(history.getByTestId('hold-void'), 'Wrong hen');
    await expect(page.getByRole('status').filter({ hasText: 'Voided.' })).toBeVisible();
    await expect(history).not.toContainText('Died');
    await noHorizontalOverflow(page);
  });

  test('a hay cutting is voided on /hay', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
      name: 'Hay field',
      acres: 3
    });
    const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: 'Hay block',
      acres: 3,
      fieldId: field.id
    });
    const { cutting } = await post<{ cutting: { id: string; cuttingNumber: number } }>(
      page,
      '/api/hay/cuttings',
      { blockId: block.id, cropPluginId: 'alfalfa-vernema', mowAt: Date.now() - 3_600_000 }
    );
    const year = new Date().getFullYear();
    await open(page, `/hay?block=${block.id}&year=${year}`);
    await expect(page.getByText(`Cutting #${cutting.cuttingNumber}`)).toBeVisible();
    // /hay's own block picker is wider than 375 px already, so check the
    // void panel itself fits.
    const panel = page.getByTestId('hold-void');
    await panel.getByRole('button', { name: 'Void this entry…' }).click();
    await panelFits(page);
    await panel.getByLabel('Why is this entry being voided?').fill('Wrong block');
    await panel.getByRole('button', { name: 'Void this entry', exact: true }).click();
    await expect(page.getByText(`Cutting #${cutting.cuttingNumber} voided.`)).toBeVisible();
    await expect(page.getByText('No cuttings recorded for this block + year.')).toBeVisible();
  });
});
