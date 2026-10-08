// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { equipment, stockLots } from '$lib/db/schema';
import { runWithTenant, tenantValues, withTenant } from '$lib/db/tenant';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { deleteSprayEvent } from '$lib/db/admin';
import { insertFertilityApplication } from '$lib/db/fertility';
import { insertFungicideEvent } from '$lib/db/fungicideEvents';
import { createPlanned } from '$lib/db/crops';
import { createStockItem, receiveLot } from '$lib/db/stock';
import { createSeedStart } from '$lib/db/seedStarts';
import { seedFarm } from '$lib/server/documents.testkit';
import { NOP_RULES_OFF } from './nopRules';
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
      insertFungicideEvent({
        blockId: farm.blockId,
        performedById: farm.ownerUser,
        occurredAt: now - 9 * DAY,
        products: [{ pluginId: 'regalia', displayName: 'Regalia', fracCodes: ['P05'] }],
        conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
        rulesVersion: 'test',
        pluginHashes: {}
      });
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
      const window = { fromMs: now - 3 * 365 * DAY, toMs: now };
      return {
        on: await loadBlockOrganicFacts([farm.blockId], window, fmt),
        off: await loadBlockOrganicFacts([farm.blockId], window, fmt, NOP_RULES_OFF)
      };
    });
    const f = facts.on.get(farm.blockId)!;
    expect(f.applications.map((a) => [a.product, a.inputClass])).toEqual([
      ['Urea (46-0-0)', 'not-allowed'],
      ['Neighbor compost', 'not-marked']
    ]);
    expect(f.lastNonAllowedAt).toBe(f.applications[1].occurredAt);
    expect(f.treatedSeedPlantings).toHaveLength(1);
    const urea = fmt(f.applications[0].occurredAt);
    const compost = fmt(f.applications[1].occurredAt);
    expect(f.transitionLine).toContain(
      `the earliest harvest date under the 3-year rule in 7 CFR 205.202(b) is`
    );
    expect(f.transitionLine).toContain(`marks as not allowed (${urea})`);
    expect(f.transitionLine).toContain(`used later (${compost}). If it is prohibited`);
    expect(f.transitionLine).toMatch(/Your certifier decides\.$/);
    expect(facts.off.get(farm.blockId)!.transitionLine).toBeNull();
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
  const none = { notAllowedAt: null, notMarkedAt: null };

  it('is null while the month count is not verified', () => {
    expect(
      transitionLine({ notAllowedAt: Date.UTC(2024, 0, 15), notMarkedAt: null }, fmt, NOP_RULES_OFF)
    ).toBeNull();
  });

  it('gives the earliest date under the 3-year rule and defers to the certifier', () => {
    expect(transitionLine({ notAllowedAt: Date.UTC(2024, 0, 31), notMarkedAt: null }, fmt)).toBe(
      'By these records, the earliest harvest date under the 3-year rule in 7 CFR 205.202(b) is 2027-01-31, 36 months after the last input the library marks as not allowed (2024-01-31). Your certifier decides.'
    );
    expect(transitionLine(none, fmt)).toBeNull();
  });

  it('never reads an unmarked input as prohibited', () => {
    expect(transitionLine({ notAllowedAt: null, notMarkedAt: Date.UTC(2025, 1, 28) }, fmt)).toBe(
      'By these records, no input the library marks as not allowed is on file. An input it does not mark either way was used on 2025-02-28. If that input is prohibited, the earliest harvest date under the 3-year rule in 7 CFR 205.202(b) is 2028-02-28, 36 months later. Your certifier decides.'
    );
    expect(
      transitionLine(
        { notAllowedAt: Date.UTC(2024, 0, 31), notMarkedAt: Date.UTC(2024, 5, 1) },
        fmt
      )
    ).toBe(
      'By these records, the earliest harvest date under the 3-year rule in 7 CFR 205.202(b) is 2027-01-31, 36 months after the last input the library marks as not allowed (2024-01-31). An input the library does not mark either way was used later (2024-06-01). If it is prohibited, the earliest date is 2027-06-01. Your certifier decides.'
    );
    const earlierUnmarked = transitionLine(
      { notAllowedAt: Date.UTC(2024, 5, 1), notMarkedAt: Date.UTC(2024, 0, 31) },
      fmt
    );
    expect(earlierUnmarked).not.toContain('does not mark either way');
  });

  it('reads in Spanish with the citation verbatim', () => {
    expect(
      transitionLine(
        { notAllowedAt: Date.UTC(2024, 0, 31), notMarkedAt: null },
        fmt,
        undefined,
        'es'
      )
    ).toBe(
      'Según estos registros, la fecha de cosecha más temprana bajo la regla de 3 años de 7 CFR 205.202(b) es el 2027-01-31, 36 meses después del último insumo que la biblioteca marca como no permitido (2024-01-31). Tu certificador decide.'
    );
  });

  it('never claims certification (B-57)', () => {
    const line = transitionLine({ notAllowedAt: Date.UTC(2024, 1, 29), notMarkedAt: null }, fmt);
    expect(line).toContain('is 2027-02-28,');
    expect(line).not.toMatch(/certified|compliant|eligible|qualif|safe|clear|—/i);
  });
});
