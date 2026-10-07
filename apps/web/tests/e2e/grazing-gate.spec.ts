import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 32C (cluster C4): the grazing gate on moves. No product carries
// sourced grazing data yet, so every sprayed pasture blocks food animals
// with GRAZING_UNKNOWN until the owner records the interval from the label.

const PHONE = { width: 375, height: 800 };

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function seedSprayedPasture(page: Page) {
  await provisionEmptyFarm(page);
  const { field: barn } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Sheep barn',
    kind: 'barn'
  });
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
  const { group } = await post<{ group: { id: string } }>(page, '/api/animal-groups', {
    name: 'Ewes',
    speciesId: 'sheep',
    headCount: 12,
    housingFieldId: barn.id
  });
  const { equipment: sprayer } = await post<{ equipment: { id: string } }>(page, '/api/equipment', {
    type: 'sprayer',
    label: 'Backpack sprayer'
  });
  const { event } = await post<{ event: { id: string } }>(page, '/api/fungicide/record', {
    sprayerId: sprayer.id,
    blockId: block.id,
    productPluginIds: ['champ-dp'],
    conditions: { windMph: 4, tempF: 70, rainForecastMmNext24h: 0 }
  });
  return { barnId: barn.id, pastureId: pasture.id, groupId: group.id, sprayId: event.id };
}

async function tryMove(page: Page, groupId: string, pastureId: string) {
  await page.goto(`/animals/groups/${groupId}`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Move' }).click();
  await page.getByLabel('Move to').selectOption(pastureId);
  await page.getByRole('button', { name: 'Save the move' }).click();
}

test.describe('grazing gate on moves', () => {
  test.describe.configure({ timeout: 120_000 });

  test('an unsourced spray blocks the ewes and names the owner', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const farm = await seedSprayedPasture(page);
    await tryMove(page, farm.groupId, farm.pastureId);
    const stop = page.getByRole('alert').filter({ hasText: 'North pasture was sprayed' });
    await expect(stop).toContainText('North pasture was sprayed with');
    await expect(stop).toContainText(
      "Food animals can't go there until the owner adds the grazing time from the label."
    );
    await noHorizontalOverflow(page);

    const api = await page.request.post('/api/animals/move', {
      data: { subjectType: 'group', subjectId: farm.groupId, fieldId: farm.pastureId },
      headers: { origin: originOf(page) }
    });
    expect(api.status()).toBe(422);
    expect((await api.json()).code).toBe('GRAZING_UNKNOWN');
    const group = await (await page.request.get(`/api/animal-groups/${farm.groupId}`)).json();
    expect(group.group.housingFieldId).toBe(farm.barnId);
  });

  test('a helper sees "Ask the owner" and has no way around the stop', async ({
    page,
    browser
  }) => {
    const farm = await seedSprayedPasture(page);
    const helper = await provisionHelper(page, browser);
    await helper.setViewportSize(PHONE);
    await tryMove(helper, farm.groupId, farm.pastureId);
    await expect(
      helper.getByRole('alert').filter({ hasText: 'North pasture was sprayed' })
    ).toContainText('Ask the owner.');
    await noHorizontalOverflow(helper);
    const api = await helper.request.post('/api/animals/move', {
      data: { subjectType: 'group', subjectId: farm.groupId, fieldId: farm.pastureId },
      headers: { origin: originOf(page) }
    });
    expect(api.status()).toBe(422);
    expect((await api.json()).askOwner).toBe(true);
    await helper.context().close();
  });

  test('the owner attestation clears exactly the attested interval', async ({ page }) => {
    const farm = await seedSprayedPasture(page);
    const attest = (grazeDays: number) =>
      page.request.post('/api/animals/grazing-attestations', {
        data: {
          fieldId: farm.pastureId,
          reason: 'Read from the label',
          items: [
            {
              sprayEventRef: `fungicide:${farm.sprayId}`,
              productPluginId: 'champ-dp',
              grazeDays,
              lactatingGrazeDays: grazeDays
            }
          ]
        },
        headers: { origin: originOf(page) }
      });
    const first = await attest(3);
    expect(first.ok(), await first.text()).toBe(true);
    const held = await page.request.post('/api/animals/move', {
      data: { subjectType: 'group', subjectId: farm.groupId, fieldId: farm.pastureId },
      headers: { origin: originOf(page) }
    });
    expect(held.status()).toBe(422);
    const body = await held.json();
    expect(body.code).toBe('GRAZING_INTERVAL');
    expect(body.clearsAtMs).toBeGreaterThan(Date.now() + 2 * 86_400_000);
  });

  test('the owner adds the grazing time from the label through the page, then the move saves', async ({
    page
  }) => {
    await page.setViewportSize(PHONE);
    const farm = await seedSprayedPasture(page);
    await tryMove(page, farm.groupId, farm.pastureId);
    await expect(
      page.getByRole('alert').filter({ hasText: 'North pasture was sprayed' })
    ).toContainText('North pasture was sprayed with');
    await page.getByRole('link', { name: 'Add the grazing time from the label' }).click();
    await page.waitForURL(`**/plan/areas/${farm.pastureId}/grazing`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Grazing and haying times' })).toBeVisible();
    const row = page.getByTestId('grazing-row').first();
    await expect(row).toContainText('Time not on file');
    await expect(row.getByLabel(/Days before grazing/)).toHaveValue('');
    await noHorizontalOverflow(page);
    await row.getByLabel(/Days before grazing/).fill('0');
    await row.getByLabel(/Days before milking animals graze/).fill('0');
    await page.getByLabel('Where you read it').fill('Label on the jug');
    await page.getByRole('button', { name: 'Save label times' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved the label time.' })
    ).toBeVisible();
    await expect(page.getByTestId('grazing-row').first()).toContainText(
      'You entered grazing 0 days'
    );

    await tryMove(page, farm.groupId, farm.pastureId);
    await expect(
      page.getByRole('status').filter({ hasText: 'Moved to North pasture' })
    ).toBeVisible();
    const group = await (await page.request.get(`/api/animal-groups/${farm.groupId}`)).json();
    expect(group.group.housingFieldId).toBe(farm.pastureId);
  });
});
