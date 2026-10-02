import type { Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 33C C3: the spread warnings. A helper builds a manure pile from
// goats that grazed a GrazonNext pasture, the owner spreads it on the
// garden, confirms the prompt, and the Block card line appears and turns
// muted after a no-damage pea test. The homestead persona's bought horse
// manure reads "Not known" and nothing on the way says it is safe.

const DAY = 86_400_000;
const PHONE = { width: 375, height: 800 };

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

function ymd(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
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

async function gardenBed(page: Page) {
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Kitchen garden',
    kind: 'garden'
  });
  const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Tomato bed',
    acres: 0.01,
    fieldId: field.id
  });
  return { gardenId: field.id, bedId: block.id };
}

async function sprayGrazonNext(page: Page, blockId: string, daysAgo: number) {
  const { equipment } = await post<{ equipment: { id: string } }>(page, '/api/equipment', {
    type: 'sprayer',
    label: `Boom ${blockId.slice(0, 4)}`
  });
  await post(page, '/api/spray/record', {
    blockId,
    occurredAt: Date.now() - daysAgo * DAY,
    blockCrops: { primary: { cropPluginId: 'timothy-climax', cropFamily: 'forage' } },
    productPluginIds: ['grazonnext-hl'],
    sprayer: { id: equipment.id },
    conditions: { windMph: 4, tempF: 70, rainForecastMmNext24h: 0 }
  });
}

test.describe('Phase 33C spread warnings', () => {
  test('helper builds a goat pile, owner confirms the garden prompt, a pea test mutes the line', async ({
    page,
    browser
  }) => {
    test.setTimeout(180_000);
    await provisionEmptyFarm(page);
    const { field: pasture } = await post<{ field: { id: string } }>(page, '/api/fields', {
      name: 'North pasture',
      kind: 'pasture',
      acres: 2
    });
    const { block: paddock } = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: 'Paddock 1',
      acres: 2,
      fieldId: pasture.id
    });
    const { group } = await post<{ group: { id: string } }>(page, '/api/animal-groups', {
      name: 'Goats',
      speciesId: 'goat',
      headCount: 4,
      housingFieldId: pasture.id
    });
    await sprayGrazonNext(page, paddock.id, 20);
    const { bedId } = await gardenBed(page);
    await post(page, `/api/blocks/${bedId}/plantings`, {
      cropPluginId: 'tomato-cherokee-purple',
      plantingDate: Date.now() - 5 * DAY
    });

    const helper = await provisionHelper(page, browser);
    const { batch } = await post<{ batch: { id: string } }>(helper, '/api/amendments/batches', {
      kind: 'manure',
      name: 'Goat pile',
      origin: 'on-farm',
      startedOn: ymd(Date.now())
    });
    const added = await post<{ batch: { state: string } }>(
      helper,
      `/api/amendments/batches/${batch.id}/inputs`,
      { inputType: 'group', inputId: group.id, from: ymd(Date.now()) }
    );
    expect(added.batch.state).toBe('may-carry');
    await helper.context().close();

    await open(page, `/fertility?block=${bedId}`);
    await page.getByRole('heading', { name: 'Record fertilizer application' }).click();
    await page.getByTestId('fertility-batch').selectOption(batch.id);
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    const prompt = page.getByTestId('carryover-confirm');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('Goat pile: May carry a weed killer');
    await expect(prompt).toContainText('Goats grazed North pasture');
    await expect(prompt).toContainText('This block is in a garden.');
    await expect(prompt).not.toContainText(/safe/i);
    await page.getByRole('button', { name: 'I understand, save it' }).click();
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByText('Spread Goat pile, confirmed past the carryover check.')
    ).toBeVisible();

    await open(page, `/plan?block=${bedId}`);
    const blockCards = page.getByTestId('plan-block-cards');
    await expect(blockCards).toContainText(
      'which may carry a weed killer that harms tomatoes, beans, peas and other broadleaf crops'
    );
    const plantingCard = page.getByTestId('planting-card').first();
    await expect(plantingCard).toContainText('Got Goat pile on');
    await plantingCard.getByRole('link', { name: 'Pea test or dismiss' }).click();
    await page.waitForURL(`**/plan/blocks/${bedId}/carryover`);

    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('carryover-line')).toHaveClass(/warn/);
    await expect(page.getByTestId('bioassay-guide')).toBeVisible();
    await page.getByLabel('No damage compared with the control pots').check();
    await page.getByRole('button', { name: 'Save the test' }).click();
    await expect(page.getByTestId('carryover-line')).toContainText('showed no damage');
    await expect(page.getByTestId('carryover-line')).not.toHaveClass(/warn/);

    await open(page, `/plan?block=${bedId}`);
    await expect(page.getByTestId('plan-block-cards')).toContainText('Your pea or bean test on');
    await expect(page.locator('body')).not.toContainText(/\bsafe\b/i);
  });

  test('homestead: bought horse manure reads Not known, and the owner can dismiss and restore the line', async ({
    page
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    const { bedId } = await gardenBed(page);
    const { batch } = await post<{ batch: { id: string; state: string } }>(
      page,
      '/api/amendments/batches',
      {
        kind: 'manure',
        name: 'Horse manure from the neighbour',
        origin: 'bought',
        supplier: 'Neighbour',
        supplierStatement: 'unknown',
        startedOn: ymd(Date.now())
      }
    );
    expect(batch.state).toBe('not-known');
    const spread = (confirmCarryover?: string) =>
      page.request.post('/api/fertility/applications', {
        data: {
          blockId: bedId,
          source: 'horse manure',
          ratePerAcre: 10,
          rateUnit: 'ton-per-acre',
          amendmentBatchId: batch.id,
          ...(confirmCarryover ? { confirmCarryover } : {})
        },
        headers: { origin: originOf(page) }
      });
    const first = await spread();
    expect(first.status()).toBe(409);
    const facts = (await first.json()) as {
      factsHash: string;
      stateLabel: string;
      message: string;
    };
    expect(facts.stateLabel).toBe('Not known');
    expect(facts.message).not.toMatch(/safe/i);
    expect((await spread(facts.factsHash)).status()).toBe(201);

    await open(page, `/plan/blocks/${bedId}/carryover`);
    await expect(page.getByTestId('carryover-line')).toContainText(
      'Whether it carries a weed killer that harms tomatoes, beans, peas and other broadleaf crops is not known.'
    );
    await expect(page.locator('body')).not.toContainText(/\bsafe\b/i);
    await noHorizontalOverflow(page);
    const save = page.getByRole('button', { name: 'Save the test' });
    expect((await save.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);

    await page.getByLabel('Why dismiss this line').fill('Neighbour showed me the hay receipts');
    await page.getByRole('button', { name: 'Dismiss this line' }).click();
    await expect(page.getByTestId('carryover-none')).toHaveText(
      'No carryover weed killer on file for what was spread here.'
    );
    await expect(page.getByText('Neighbour showed me the hay receipts')).toBeVisible();
    await page.getByRole('button', { name: 'Bring the line back' }).click();
    await expect(page.getByTestId('carryover-line')).toBeVisible();

    await open(page, `/inventory/amendment/${batch.id}`);
    await expect(page.getByText('Not known').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tomato bed' })).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('a hay cutting from GrazonNext ground shows the off-farm label notice', async ({ page }) => {
    test.setTimeout(120_000);
    await provisionEmptyFarm(page);
    const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
      name: 'Hay field',
      kind: 'field',
      acres: 3
    });
    const { block } = await post<{ block: { id: string } }>(page, '/api/blocks', {
      name: 'Timothy',
      acres: 3,
      fieldId: field.id
    });
    await sprayGrazonNext(page, block.id, 30);
    await post(page, '/api/hay/cuttings', {
      blockId: block.id,
      cropPluginId: 'timothy-climax',
      mowAt: Date.now() - 3_600_000
    });
    await open(page, `/hay?block=${block.id}&year=${new Date().getFullYear()}`);
    const notice = page.getByTestId('hay-off-farm');
    await expect(notice).toContainText(
      'label limits moving or selling hay from treated ground off the farm. Read the label before you sell or move this hay.'
    );
    await expect(notice).toContainText('EPA Reg. No. 62719-628');
  });
});
