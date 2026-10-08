// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/auth')>()),
  ...(await import('$lib/server/documents.testkit')).authOverrides()
}));

import { runWithTenant } from '$lib/db/tenant';
import { createBlock } from '$lib/db/blocks';
import { fertilityBudgetForBlock, getFertilityApplication } from '$lib/db/fertility';
import {
  createStockItem,
  getStockItemWithBalance,
  listMovementsForItem,
  receiveLot
} from '$lib/db/stock';
import { actAs, call, seedFarm, type TestFarm } from '$lib/server/documents.testkit';
import { POST } from './+server';

let farm: TestFarm;
const inFarm = <T>(fn: () => T): T => runWithTenant(farm.ownerId, fn);

beforeEach(() => {
  farm = seedFarm();
  actAs(farm, 'owner');
});

function wheatField(acres: number | null = 15): string {
  return inFarm(
    () => createBlock({ name: 'Wheat A', fieldId: farm.fieldId, acres: acres ?? undefined }).id
  );
}

function urea(onHandLb: number, orderedLb = 0): string {
  return inFarm(() => {
    const item = createStockItem({
      category: 'fertilizer',
      displayName: 'Urea (46-0-0)',
      defaultUnit: 'lb',
      pluginId: 'urea-46-0-0'
    });
    receiveLot({ stockItemId: item.id, receivedQuantity: onHandLb, unit: 'lb' });
    if (orderedLb > 0) {
      receiveLot({
        stockItemId: item.id,
        receivedQuantity: orderedLb,
        unit: 'lb',
        quantityStatus: 'ordered'
      });
    }
    return item.id;
  });
}

async function record(json: Record<string, unknown>) {
  const res = await call(POST, { method: 'POST', path: '/api/fertility/applications', json });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/fertility/applications', () => {
  it('stores nutrients the farmer did not give as not known, never 0 (#738)', async () => {
    const blockId = wheatField();
    const { status, body } = await record({
      blockId,
      source: 'Goat manure',
      ratePerAcre: 2,
      rateUnit: 'wheelbarrows'
    });
    expect(status).toBe(201);
    const id = (body.application as { id: string }).id;
    const saved = inFarm(() => getFertilityApplication(id))!;
    expect(saved.nLbPerAcre).toBeNull();
    expect(saved.pLbPerAcre).toBeNull();
    expect(saved.kLbPerAcre).toBeNull();
    const year = new Date(saved.occurredAt).getFullYear();
    const budget = inFarm(() => fertilityBudgetForBlock(blockId, year));
    expect(budget.nDeliveredLbPerAcre).toBe(0);
    expect(budget.nUnknownApplications).toBe(1);
  });

  it('keeps an explicit 0 apart from not known', async () => {
    const blockId = wheatField();
    const { body } = await record({
      blockId,
      source: 'Urea (46-0-0)',
      ratePerAcre: 65,
      rateUnit: 'lb-per-acre',
      nLbPerAcre: 29.9,
      pLbPerAcre: 0,
      kLbPerAcre: null
    });
    const saved = inFarm(() => getFertilityApplication((body.application as { id: string }).id))!;
    expect(saved.nLbPerAcre).toBe(29.9);
    expect(saved.pLbPerAcre).toBe(0);
    expect(saved.kLbPerAcre).toBeNull();
  });

  it('takes rate x acres off the on-hand lots and leaves ordered lots alone (#763)', async () => {
    const blockId = wheatField(15);
    const itemId = urea(4000, 500);
    const { status, body } = await record({
      blockId,
      source: 'Urea (46-0-0)',
      stockItemId: itemId,
      ratePerAcre: 65,
      rateUnit: 'lb-per-acre'
    });
    expect(status).toBe(201);
    const stock = body.stock as { drawn: number; shortfall: number; notes: string[] };
    expect(stock.drawn).toBe(975);
    expect(stock.shortfall).toBe(0);
    const item = inFarm(() => getStockItemWithBalance(itemId))!;
    expect(item.onHand).toBe(3025);
    expect(item.onOrder).toBe(500);
    const appId = (body.application as { id: string }).id;
    const draws = inFarm(() => listMovementsForItem(itemId)).filter((m) => m.delta < 0);
    expect(draws).toHaveLength(1);
    expect(draws[0].reason).toBe('fertility-application');
    expect(draws[0].fertilityApplicationId).toBe(appId);
  });

  it('saves the record and says so when stock comes up short', async () => {
    const blockId = wheatField(15);
    const itemId = urea(100);
    const { status, body } = await record({
      blockId,
      source: 'Urea (46-0-0)',
      stockItemId: itemId,
      ratePerAcre: 65,
      rateUnit: 'lb-per-acre'
    });
    expect(status).toBe(201);
    const stock = body.stock as { drawn: number; shortfall: number; notes: string[] };
    expect(stock.drawn).toBe(100);
    expect(stock.shortfall).toBe(875);
    expect(stock.notes.join(' ')).toContain('not enough on hand');
  });

  it('takes nothing when the block has no size, or the unit is not a stock unit', async () => {
    const itemId = urea(4000);
    const noSize = await record({
      blockId: wheatField(null),
      source: 'Urea',
      stockItemId: itemId,
      ratePerAcre: 65,
      rateUnit: 'lb-per-acre'
    });
    expect(noSize.status).toBe(201);
    expect((noSize.body.stock as { notes: string[] }).notes[0]).toContain('no size');
    const typedUnit = await record({
      blockId: wheatField(15),
      source: 'Urea',
      stockItemId: itemId,
      ratePerAcre: 2,
      rateUnit: 'scoops'
    });
    expect(typedUnit.status).toBe(201);
    expect(inFarm(() => getStockItemWithBalance(itemId))!.onHand).toBe(4000);
  });

  it('records the chosen date and refuses a future one (#739)', async () => {
    const blockId = wheatField();
    const past = Date.now() - 3 * 86_400_000;
    const ok = await record({
      blockId,
      source: 'Urea',
      ratePerAcre: 65,
      rateUnit: 'lb-per-acre',
      occurredAt: past
    });
    expect((ok.body.application as { occurredAt: number }).occurredAt).toBe(past);
    const future = await record({
      blockId,
      source: 'Urea',
      ratePerAcre: 65,
      rateUnit: 'lb-per-acre',
      occurredAt: Date.now() + 86_400_000
    });
    expect(future.status).toBe(400);
    expect(future.body.code).toBe('IN_THE_FUTURE');
  });

  it("refuses another farm's stock item", async () => {
    const blockId = wheatField();
    const other = farm;
    farm = seedFarm();
    const foreignItem = urea(4000);
    farm = other;
    const res = await record({
      blockId,
      source: 'Urea',
      stockItemId: foreignItem,
      ratePerAcre: 65,
      rateUnit: 'lb-per-acre'
    });
    expect(res.status).toBe(400);
  });
});
