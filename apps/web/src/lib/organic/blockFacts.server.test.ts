// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { equipment, stockLots } from '$lib/db/schema';
import { runWithTenant, tenantValues, withTenant } from '$lib/db/tenant';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { deleteSprayEvent } from '$lib/db/admin';
import { insertFertilityApplication } from '$lib/db/fertility';
import { createPlanned } from '$lib/db/crops';
import { createStockItem, receiveLot } from '$lib/db/stock';
import { createSeedStart } from '$lib/db/seedStarts';
import { seedFarm } from '$lib/server/documents.testkit';
import { NOP_RULES } from './nopRules';
import { loadBlockOrganicFacts, transitionLine } from './blockFacts.server';

const DAY = 86_400_000;
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('blockOrganicFacts', () => {
  it('lists not-allowed and not-marked inputs, skips allowed ones, and finds treated seed', async () => {
    const farm = seedFarm();
    const now = Date.now();
    const facts = await runWithTenant(farm.ownerId, async () => {
      const apply = (source: string, at: number) =>
        insertFertilityApplication({
          blockId: farm.blockId,
          occurredAt: at,
          source,
          ratePerAcre: 100,
          rateUnit: 'lb'
        });
      apply('urea-46-0-0', now - 10 * DAY);
      apply('biochar', now - 9 * DAY);
      apply('Neighbor compost', now - 8 * DAY);
      apply('urea-46-0-0', now - 2000 * DAY);
      const crop = createPlanned({
        blockId: farm.blockId,
        cropPluginId: 'crop:tomato',
        varietyDisplayName: 'Roma'
      });
      const item = createStockItem({
        category: 'seed',
        displayName: 'Roma seed',
        defaultUnit: 'packet' as never
      });
      const lot = receiveLot({
        stockItemId: item.id,
        receivedQuantity: 1,
        unit: 'packet' as never
      });
      db.update(stockLots)
        .set({ seedOrganicStatus: 'treated' })
        .where(withTenant(stockLots, eq(stockLots.id, lot.id)))
        .run();
      createSeedStart({
        cropId: crop.id,
        sownAt: now - 5 * DAY,
        performedById: null,
        stockLotId: lot.id
      });
      return loadBlockOrganicFacts([farm.blockId], { fromMs: now - 3 * 365 * DAY, toMs: now }, fmt);
    });
    const f = facts.get(farm.blockId)!;
    expect(f.applications.map((a) => [a.product, a.inputClass])).toEqual([
      ['Urea (46-0-0)', 'not-allowed'],
      ['Neighbor compost', 'not-marked']
    ]);
    expect(f.lastNonAllowedAt).toBe(f.applications[1].occurredAt);
    expect(f.treatedSeedPlantings).toHaveLength(1);
    expect(f.transitionLine).toBeNull();
  });

  it('never leaks another farm records', async () => {
    const a = seedFarm();
    const b = seedFarm();
    runWithTenant(a.ownerId, () =>
      insertFertilityApplication({
        blockId: a.blockId,
        occurredAt: Date.now(),
        source: 'urea-46-0-0',
        ratePerAcre: 1,
        rateUnit: 'lb'
      })
    );
    const facts = await runWithTenant(b.ownerId, () =>
      loadBlockOrganicFacts([a.blockId, b.blockId], { fromMs: 0, toMs: Date.now() })
    );
    expect(facts.get(a.blockId)?.applications ?? []).toEqual([]);
    expect(facts.get(b.blockId)?.applications).toEqual([]);
  });
});

describe('deleted applications', () => {
  it('a deleted spray that still counts as applied stays a fact; never applied drops it', async () => {
    const farm = seedFarm();
    const now = Date.now();
    const facts = await runWithTenant(farm.ownerId, async () => {
      const sprayerId = `${farm.ownerId}-sprayer`;
      db.insert(equipment)
        .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Sprayer' }))
        .run();
      const spray = (daysAgo: number) =>
        insertSprayEvent({
          blockId: farm.blockId,
          sprayerId,
          performedById: farm.ownerUser,
          occurredAt: now - daysAgo * DAY,
          products: [{ pluginId: 'glyphosate-generic', chemistryClasses: ['glyphosate'] }],
          conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
          rulesVersion: 'test',
          pluginHashes: {}
        });
      const kept = spray(30);
      const never = spray(20);
      deleteSprayEvent(kept.id, { force: true, tombstone: true, reason: 'planting removed' });
      deleteSprayEvent(never.id, {
        force: true,
        tombstone: true,
        reason: 'typed by mistake',
        neverApplied: true
      });
      return loadBlockOrganicFacts([farm.blockId], { fromMs: now - 365 * DAY, toMs: now }, fmt);
    });
    const f = facts.get(farm.blockId)!;
    expect(f.applications).toHaveLength(1);
    expect(f.applications[0]).toMatchObject({
      kind: 'spray',
      product: 'Glyphosate 41%',
      inputClass: 'not-allowed',
      deleted: true
    });
    expect(f.lastNonAllowedAt).toBe(now - 30 * DAY);
  });
});

describe('transitionLine (O-03, B-04)', () => {
  it('is null while the month count is not verified', () => {
    expect(transitionLine(Date.UTC(2024, 0, 15), fmt)).toBeNull();
  });
  it('reads as arithmetic and defers to the certifier once on', () => {
    expect(
      transitionLine(Date.UTC(2024, 0, 31), fmt, { ...NOP_RULES, landTransitionMonths: 36 })
    ).toBe('By these records, 36 months after 2024-01-31 is 2027-01-31. Your certifier decides.');
    expect(transitionLine(null, fmt, { ...NOP_RULES, landTransitionMonths: 36 })).toBeNull();
  });
});
