// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from './client';
import { owners } from './schema';
import { runWithTenant } from './tenant';
import { createField, listFields } from './fields';
import { createMapFeature, listMapFeatures } from './mapFeatures';
import { wipeAllData } from './admin';

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
}

describe('wipeAllData', () => {
  it("removes the Owner's fences, gates and water sources with the fields", () => {
    const other = seedOwner();
    runWithTenant(other, seedFarm);
    runWithTenant(seedOwner(), () => {
      seedFarm();
      const out = wipeAllData();
      expect(out.removed.map_features).toBe(2);
      expect(out.removed.fields).toBe(1);
      expect(listMapFeatures()).toEqual([]);
      expect(listFields()).toEqual([]);
    });
    runWithTenant(other, () => {
      expect(listMapFeatures()).toHaveLength(2);
      expect(listFields()).toHaveLength(1);
    });
  });
});
