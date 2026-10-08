import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { db } from './client';
import { equipment, owners, users } from './schema';
import { runWithTenant, tenantValues } from './tenant';
import { createField } from './fields';
import { addPlanting, createBlock } from './blocks';
import { insertSprayEvent } from './sprayEvents';
import { insertScoutObservation } from './scoutObservations';
import { insertHarvestEvent } from './harvestEvents';
import { countPlannedPlantings, isPlantedRecord, listUnifiedRecords } from './recordsUnified';
import { DEFAULT_PREFS } from '$lib/prefs';

const DAY = 86_400_000;

function farm() {
  const ownerId = `rec-names-${randomUUID().slice(0, 8)}`;
  const userId = `${ownerId}-u`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test.local` })
    .onConflictDoNothing()
    .run();
  const ids = runWithTenant(ownerId, () => {
    const field = createField({ name: `${ownerId}-field` });
    const block = createBlock({ name: `${ownerId}-block`, fieldId: field.id, acres: 1 });
    return { blockId: block.id };
  });
  return { ownerId, userId, ...ids };
}

describe('isPlantedRecord (#630)', () => {
  const now = Date.parse('2027-02-01T12:00:00Z');
  it('is false for undated, future-dated and still-planned plantings', () => {
    expect(isPlantedRecord({ plantingDate: null, status: 'active' }, now)).toBe(false);
    expect(isPlantedRecord({ plantingDate: now + DAY, status: 'active' }, now)).toBe(false);
    expect(isPlantedRecord({ plantingDate: now - DAY, status: 'planned' }, now)).toBe(false);
  });
  it('is true once the date has come or the planting closed out', () => {
    expect(isPlantedRecord({ plantingDate: now - DAY, status: 'active' }, now)).toBe(true);
    expect(isPlantedRecord({ plantingDate: now, status: 'active' }, now)).toBe(true);
    expect(isPlantedRecord({ plantingDate: now - DAY, status: 'harvested' }, now)).toBe(true);
  });
});

describe('listUnifiedRecords — planned plantings (#630)', () => {
  it('leaves plans off the ledger and counts them', () => {
    const f = farm();
    runWithTenant(f.ownerId, () => {
      const now = Date.now();
      const planted = addPlanting({
        blockId: f.blockId,
        cropPluginId: 'lettuce-fixture',
        varietyDisplayName: 'Buttercrunch',
        plantingDate: now - DAY
      });
      const future = addPlanting({
        blockId: f.blockId,
        cropPluginId: 'tomato-fixture',
        varietyDisplayName: 'Brandywine',
        plantingDate: now + 30 * DAY
      });
      const planned = addPlanting({
        blockId: f.blockId,
        cropPluginId: 'kale-fixture',
        varietyDisplayName: 'Lacinato',
        plantingDate: now - DAY,
        status: 'planned'
      });
      const rows = listUnifiedRecords({ kinds: ['planting'] });
      const ids = rows.map((r) => r.rowId);
      expect(ids).toEqual([planted.id]);
      expect(ids).not.toContain(future.id);
      expect(ids).not.toContain(planned.id);
      expect(rows[0].detail).toBe('Buttercrunch');
      expect(countPlannedPlantings()).toBe(2);
    });
  });
});

describe('listUnifiedRecords — names, not ids (#631)', () => {
  it('names products and crops and spells out metrics', () => {
    const f = farm();
    runWithTenant(f.ownerId, () => {
      const sprayerId = `${f.ownerId}-sprayer`;
      db.insert(equipment)
        .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Sprayer' }))
        .run();
      const now = Date.now();
      insertSprayEvent({
        blockId: f.blockId,
        sprayerId,
        performedById: f.userId,
        occurredAt: now - 60_000,
        products: [{ pluginId: 'roundup-fixture', chemistryClasses: ['glyphosate'] }],
        conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
        rulesVersion: 'test-rules',
        pluginHashes: {}
      });
      insertHarvestEvent({
        blockId: f.blockId,
        cropPluginId: 'spinach-fixture',
        occurredAt: now - 50_000,
        quantity: '2.5 lb'
      });
      insertScoutObservation({
        blockId: f.blockId,
        performedById: f.userId,
        pest: 'aphids',
        metric: 'count-per-leaf',
        value: 1.2,
        occurredAt: now - 40_000
      });
      insertScoutObservation({
        blockId: f.blockId,
        performedById: f.userId,
        pest: 'note',
        metric: 'note',
        value: 0,
        notes: 'Full bloom on Gala',
        occurredAt: now - 30_000
      });
      const names = {
        product: (id: string) => (id === 'roundup-fixture' ? 'Roundup PowerMAX 3' : undefined),
        crop: (id: string) => (id === 'spinach-fixture' ? 'Bloomsdale spinach' : undefined)
      };
      const rows = listUnifiedRecords({}, DEFAULT_PREFS, names);
      const spray = rows.find((r) => r.kind === 'spray')!;
      const harvest = rows.find((r) => r.kind === 'harvest')!;
      const scouts = rows.filter((r) => r.kind === 'scout').map((r) => r.detail);
      expect(spray.detail).toMatch(/^Roundup PowerMAX 3 · /);
      expect(harvest.detail).toBe('Bloomsdale spinach · 2.5 lb');
      expect(harvest.cropLabel).toBe('Bloomsdale spinach');
      expect(harvest.cropPluginId).toBe('spinach-fixture');
      expect(scouts).toContain('aphids · Per leaf: 1.2');
      expect(scouts).toContain('Full bloom on Gala');

      const es = listUnifiedRecords({ kinds: ['scout'] }, { ...DEFAULT_PREFS, locale: 'es' });
      expect(es.map((r) => r.detail)).toContain('aphids · Por hoja: 1.2');
    });
  });

  it('keeps plugin ids when no names are passed (GDPR export)', () => {
    const f = farm();
    runWithTenant(f.ownerId, () => {
      insertHarvestEvent({
        blockId: f.blockId,
        cropPluginId: 'spinach-fixture',
        occurredAt: Date.now() - 1000,
        quantity: '1 lb'
      });
      const [row] = listUnifiedRecords({ kinds: ['harvest'] });
      expect(row.detail).toBe('spinach-fixture · 1 lb');
      expect(row.cropLabel).toBeUndefined();
    });
  });
});
