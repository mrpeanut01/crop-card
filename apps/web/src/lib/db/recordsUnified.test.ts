/**
 * Sprint 2 (#155, #156, #158) — unified records loader regression
 * tests. Confirms:
 *   - every record kind round-trips through `listUnifiedRecords` with the
 *     expected discriminator
 *   - tenant isolation is preserved (Owner X never sees Owner Y rows)
 *   - the summary tallies locked / ytd / countsByKind correctly
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { db } from './client';
import { equipment, equipmentLog, owners, users } from './schema';
import { runWithTenant } from './tenant';
import { createField } from './fields';
import { createBlock, addPlanting } from './blocks';
import { insertSprayEvent } from './sprayEvents';
import { insertInsecticideEvent } from './insecticideEvents';
import { insertFungicideEvent } from './fungicideEvents';
import { insertScoutObservation } from './scoutObservations';
import { insertHarvestEvent } from './harvestEvents';
import { createCutting, advanceCutting } from './hayCuttings';
import { insertFertilityApplication } from './fertility';
import {
  KIND_LABEL,
  KIND_TONE,
  RECORD_KINDS,
  listUnifiedRecords,
  summarizeUnifiedRecords
} from './recordsUnified';

function ensureOwner(id: string): void {
  db.insert(owners)
    .values({
      id,
      name: id,
      slug: id.replace(/[^a-z0-9-]/g, '-'),
      billingStatus: 'active'
    })
    .onConflictDoNothing()
    .run();
}

function ensureUser(id: string): void {
  db.insert(users)
    .values({ id, email: `${id}@test.local` })
    .onConflictDoNothing()
    .run();
}

function seedAllKinds(ownerId: string, userId: string) {
  return runWithTenant(ownerId, () => {
    const field = createField({ name: `${ownerId}-field-${randomUUID().slice(0, 6)}` });
    const block = createBlock({
      name: `${ownerId}-block-${randomUUID().slice(0, 6)}`,
      fieldId: field.id,
      acres: 1
    });
    const sprayerId = `${ownerId}-sprayer-${randomUUID().slice(0, 6)}`;
    db.insert(equipment)
      .values({ id: sprayerId, ownerId, type: 'sprayer', label: `${ownerId} sprayer` })
      .run();

    const now = Date.now();

    // spray
    const spray = insertSprayEvent({
      blockId: block.id,
      sprayerId,
      performedById: userId,
      occurredAt: now - 60_000,
      products: [{ pluginId: 'herb:fixture', chemistryClasses: ['glyphosate'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'test-rules',
      pluginHashes: { 'herb:fixture': 'abc' }
    });

    // insecticide
    const insecticide = insertInsecticideEvent({
      blockId: block.id,
      performedById: userId,
      occurredAt: now - 30_000,
      products: [{ pluginId: 'pest:fixture', displayName: 'TestPest', iracGroups: ['1A'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'test-rules',
      pluginHashes: { 'pest:fixture': 'def' }
    });

    // fungicide
    const fungicide = insertFungicideEvent({
      blockId: block.id,
      performedById: userId,
      occurredAt: now - 20_000,
      products: [{ pluginId: 'fun:fixture', displayName: 'TestFung', fracCodes: ['M03'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'test-rules',
      pluginHashes: { 'fun:fixture': 'ghi' }
    });

    // scout
    const scout = insertScoutObservation({
      blockId: block.id,
      performedById: userId,
      pest: 'aphid',
      metric: 'count-per-leaf',
      value: 4,
      occurredAt: now - 15_000
    });

    // harvest (with stored moisture — #326)
    const harvest = insertHarvestEvent({
      blockId: block.id,
      cropPluginId: 'lettuce-fixture',
      occurredAt: now - 10_000,
      quantity: '8 lb',
      moisturePct: 13.2
    });

    // hay cutting (#326) — mow → bale workflow, carries bale moisture.
    const cutting = createCutting({
      blockId: block.id,
      cropPluginId: 'orchardgrass-fixture',
      year: new Date(now).getFullYear(),
      mowAt: now - 9_000,
      rulesVersion: 'test-rules'
    });
    advanceCutting(cutting.id, {
      status: 'baling',
      occurredAt: now - 8_500,
      baleType: 'small-square',
      balesQuantity: 40,
      baleMoisturePct: 16.5
    });

    // fertility
    const fertility = insertFertilityApplication({
      blockId: block.id,
      occurredAt: now - 8_000,
      source: 'urea-fixture',
      ratePerAcre: 60,
      rateUnit: 'lb',
      nLbPerAcre: 28,
      performedById: userId
    });

    // planting
    const planting = addPlanting({
      blockId: block.id,
      cropPluginId: 'lettuce-fixture',
      varietyDisplayName: 'Buttercrunch',
      plantingDate: now - 5_000
    });

    // decon (equipment_log row, kind='decon')
    const deconId = randomUUID();
    db.insert(equipmentLog)
      .values({
        id: deconId,
        ownerId,
        equipmentId: sprayerId,
        occurredAt: new Date(now - 2_000),
        kind: 'decon',
        performedById: userId,
        notes: 'triple rinse + ammonia'
      })
      .run();

    return {
      blockId: block.id,
      ids: {
        spray: spray.id,
        insecticide: insecticide.id,
        fungicide: fungicide.id,
        scout: scout.id,
        harvest: harvest.id,
        hay: cutting.id,
        fertility: fertility.id,
        planting: planting.id,
        decon: deconId
      }
    };
  });
}

describe('recordsUnified — listUnifiedRecords', () => {
  it('exposes every record kind in one merged ledger', () => {
    const ownerId = `rec-owner-${randomUUID().slice(0, 6)}`;
    const userId = `rec-user-${randomUUID().slice(0, 6)}`;
    ensureOwner(ownerId);
    ensureUser(userId);
    const seeded = seedAllKinds(ownerId, userId);

    runWithTenant(ownerId, () => {
      const records = listUnifiedRecords();
      const kinds = new Set(records.map((r) => r.kind));
      for (const k of RECORD_KINDS) {
        expect(kinds.has(k)).toBe(true);
      }
      // Each underlying row should have a matching unified record.
      for (const [kind, rowId] of Object.entries(seeded.ids)) {
        const match = records.find((r) => r.kind === kind && r.rowId === rowId);
        expect(match, `missing ${kind} record ${rowId}`).toBeDefined();
        // Composite id format the drill-down route relies on.
        expect(match?.id).toBe(`${kind}:${rowId}`);
      }
      // Sorted descending by occurredAt.
      for (let i = 1; i < records.length; i += 1) {
        expect(records[i - 1].occurredAt).toBeGreaterThanOrEqual(records[i].occurredAt);
      }
    });
  });

  it('surfaces the hay cutting branch with cutting #, status, bale + moisture (#326)', () => {
    const ownerId = `rec-hay-${randomUUID().slice(0, 6)}`;
    const userId = `rec-hay-user-${randomUUID().slice(0, 6)}`;
    ensureOwner(ownerId);
    ensureUser(userId);
    const seeded = seedAllKinds(ownerId, userId);

    runWithTenant(ownerId, () => {
      const records = listUnifiedRecords();
      const hay = records.find((r) => r.kind === 'hay' && r.rowId === seeded.ids.hay);
      expect(hay, 'hay cutting must appear in the unified ledger').toBeDefined();
      expect(hay?.detail).toContain('cutting 1');
      expect(hay?.detail).toContain('baling');
      expect(hay?.detail).toContain('40 small-square');
      expect(hay?.detail).toContain('16.5% moisture');
      // Filtering to only `hay` returns the cutting and no pesticide rows.
      const only = listUnifiedRecords({ kinds: ['hay'] });
      expect(only.every((r) => r.kind === 'hay')).toBe(true);
      expect(only.some((r) => r.rowId === seeded.ids.hay)).toBe(true);
    });
  });

  it('surfaces stored harvest moisture in the harvest detail (#326)', () => {
    const ownerId = `rec-hm-${randomUUID().slice(0, 6)}`;
    const userId = `rec-hm-user-${randomUUID().slice(0, 6)}`;
    ensureOwner(ownerId);
    ensureUser(userId);
    const seeded = seedAllKinds(ownerId, userId);

    runWithTenant(ownerId, () => {
      const records = listUnifiedRecords();
      const harvest = records.find((r) => r.kind === 'harvest' && r.rowId === seeded.ids.harvest);
      expect(harvest?.detail).toContain('13.2% moisture');
    });
  });

  it('is tenant-scoped — Owner X never sees Owner Y rows', () => {
    const ownerX = `rec-x-${randomUUID().slice(0, 6)}`;
    const ownerY = `rec-y-${randomUUID().slice(0, 6)}`;
    const userId = `rec-shared-${randomUUID().slice(0, 6)}`;
    ensureOwner(ownerX);
    ensureOwner(ownerY);
    ensureUser(userId);
    const x = seedAllKinds(ownerX, userId);
    const y = seedAllKinds(ownerY, userId);

    runWithTenant(ownerX, () => {
      const ids = new Set(listUnifiedRecords().map((r) => `${r.kind}:${r.rowId}`));
      for (const [kind, rowId] of Object.entries(x.ids)) {
        expect(ids.has(`${kind}:${rowId}`)).toBe(true);
      }
      for (const [kind, rowId] of Object.entries(y.ids)) {
        expect(ids.has(`${kind}:${rowId}`)).toBe(false);
      }
    });
    runWithTenant(ownerY, () => {
      const ids = new Set(listUnifiedRecords().map((r) => `${r.kind}:${r.rowId}`));
      for (const [kind, rowId] of Object.entries(y.ids)) {
        expect(ids.has(`${kind}:${rowId}`)).toBe(true);
      }
      for (const [kind, rowId] of Object.entries(x.ids)) {
        expect(ids.has(`${kind}:${rowId}`)).toBe(false);
      }
    });
  });

  it('summarizeUnifiedRecords tallies per-kind counts + lock counts + ytd', () => {
    const ownerId = `rec-sum-${randomUUID().slice(0, 6)}`;
    const userId = `rec-sum-user-${randomUUID().slice(0, 6)}`;
    ensureOwner(ownerId);
    ensureUser(userId);
    seedAllKinds(ownerId, userId);

    runWithTenant(ownerId, () => {
      const records = listUnifiedRecords();
      const summary = summarizeUnifiedRecords(records);
      // All seeded rows are < 1 minute old, so none are locked yet (lock window is 48h).
      expect(summary.locked).toBe(0);
      // Every kind should have at least one row.
      for (const k of RECORD_KINDS) {
        expect(summary.countsByKind[k]).toBeGreaterThanOrEqual(1);
      }
      expect(summary.ytd).toBe(summary.total);
      // Retention horizon is newest + 2y.
      expect(summary.retentionUntilMs).toBeGreaterThan(Date.now());
    });
  });

  it('kind chip tones + labels are defined for every kind', () => {
    for (const k of RECORD_KINDS) {
      expect(KIND_LABEL[k]).toBeTruthy();
      expect(KIND_TONE[k]).toBeTruthy();
    }
  });
});
