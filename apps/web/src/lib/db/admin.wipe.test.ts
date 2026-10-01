// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from './client';
import { eq } from 'drizzle-orm';
import { blobDeletions, owners } from './schema';
import {
  PHASE_33_TABLES,
  listPhase33Ids,
  seedPhase33,
  type Phase33Table
} from './phase33.fixtures';
import { getDocument, ownerStoragePrefix } from './documents';
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

  it('removes every Phase 33 row, queues the storage prefix with it, and leaves other Owners alone', () => {
    const other = seedOwner();
    const kept = seedPhase33(other, 'wipe33-other');
    const mine = seedOwner();
    seedPhase33(mine, 'wipe33-mine');
    runWithTenant(mine, () => {
      const out = wipeAllData();
      for (const table of Object.keys(PHASE_33_TABLES) as Phase33Table[]) {
        expect(out.removed[table], table).toBe(1);
        expect(listPhase33Ids(table), table).toEqual([]);
      }
    });
    const queued = db
      .select()
      .from(blobDeletions)
      .where(eq(blobDeletions.storagePrefix, ownerStoragePrefix(mine)))
      .all();
    expect(queued).toHaveLength(1);
    expect(queued[0].attempts).toBe(0);
    expect(
      db
        .select()
        .from(blobDeletions)
        .where(eq(blobDeletions.storagePrefix, ownerStoragePrefix(other)))
        .all()
    ).toEqual([]);
    runWithTenant(other, () => {
      for (const table of Object.keys(PHASE_33_TABLES) as Phase33Table[]) {
        expect(listPhase33Ids(table), table).toEqual([kept.rowIds[table]]);
      }
      expect(getDocument(kept.documentId)?.storageKey).toBe(kept.storageKey);
    });
  });

  it('a second wipe of the same farm keeps one queued prefix', () => {
    const mine = seedOwner();
    seedPhase33(mine, 'wipe33-twice');
    runWithTenant(mine, () => {
      wipeAllData();
      wipeAllData();
    });
    expect(
      db
        .select()
        .from(blobDeletions)
        .where(eq(blobDeletions.storagePrefix, ownerStoragePrefix(mine)))
        .all()
    ).toHaveLength(1);
  });
});
