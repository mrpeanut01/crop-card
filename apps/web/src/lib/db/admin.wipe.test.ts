// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from './client';
import { owners } from './schema';
import { runWithTenant } from './tenant';
import { createField, listFields } from './fields';
import { createMapFeature, listMapFeatures } from './mapFeatures';
import { wipeAllData } from './admin';
import {
  PHASE_32_TABLES,
  listPhase32Ids,
  seedPhase32Rows,
  type Phase32Table
} from './phase32.fixtures';

function seedOwner(): string {
  const id = `wipe-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedFarm() {
  const field = createField({
    name: 'North pasture',
    kind: 'pasture',
    widthFt: 200,
    lengthFt: 300
  });
  createMapFeature({
    kind: 'fence',
    name: 'North fence',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-77.55, 39.1],
        [-77.549, 39.1]
      ]
    },
    fieldId: field.id
  });
  createMapFeature({
    kind: 'water_source',
    name: 'Well',
    geometry: { type: 'Point', coordinates: [-77.55, 39.1] },
    details: { source: 'well' }
  });
  createMapFeature({
    kind: 'hydrant',
    name: 'Pasture waterer',
    geometry: { type: 'Point', coordinates: [-77.55, 39.1] },
    areaIds: [field.id]
  });
}

describe('wipeAllData', () => {
  it("removes the Owner's fences, gates and water sources with the fields", () => {
    const other = seedOwner();
    runWithTenant(other, seedFarm);
    runWithTenant(seedOwner(), () => {
      seedFarm();
      const out = wipeAllData();
      expect(out.removed.map_features).toBe(3);
      expect(out.removed.map_feature_areas).toBe(1);
      expect(out.removed.fields).toBe(1);
      expect(listMapFeatures()).toEqual([]);
      expect(listFields()).toEqual([]);
    });
    runWithTenant(other, () => {
      expect(listMapFeatures()).toHaveLength(3);
      expect(listMapFeatures().find((f) => f.kind === 'hydrant')?.areaIds).toHaveLength(1);
      expect(listFields()).toHaveLength(1);
    });
  });

  it("removes the Owner's rows in every Phase 32 table and leaves other Owners alone", () => {
    const other = seedOwner();
    const kept = runWithTenant(other, () => seedPhase32Rows('wipe-other'));
    runWithTenant(seedOwner(), () => {
      seedPhase32Rows('wipe-mine');
      const out = wipeAllData();
      for (const table of Object.keys(PHASE_32_TABLES) as Phase32Table[]) {
        expect(out.removed[table], table).toBe(1);
        expect(listPhase32Ids(table), table).toEqual([]);
      }
    });
    runWithTenant(other, () => {
      for (const table of Object.keys(PHASE_32_TABLES) as Phase32Table[]) {
        expect(listPhase32Ids(table), table).toEqual([kept.rowIds[table]]);
      }
    });
  });
});
