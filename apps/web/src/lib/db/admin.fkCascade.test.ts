// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { owners, recordDeletions, users } from './schema';
import { runWithTenant, withTenant } from './tenant';
import { createField } from './fields';
import { addPlanting, createBlock, getBlock } from './blocks';
import { getFungicideEvent, insertFungicideEvent } from './fungicideEvents';
import { insertScoutObservation, listScoutObservations } from './scoutObservations';
import { deleteBlockCascade, deleteCropCascade, wipeAllData } from './admin';

function seedOwner(): string {
  const id = `fkc-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedUser(): string {
  const id = `fkc-user-${randomUUID()}`;
  db.insert(users)
    .values({ id, email: `${id}@fkc.test` })
    .run();
  return id;
}

function seedRecords(userId: string, withCrop: boolean) {
  const field = createField({ name: `f-${randomUUID().slice(0, 6)}` });
  const block = createBlock({ name: `b-${randomUUID().slice(0, 6)}`, fieldId: field.id, acres: 1 });
  const crop = withCrop
    ? addPlanting({
        blockId: block.id,
        cropPluginId: 'tomato',
        varietyDisplayName: 'Tomato',
        plantingDate: Date.now() - 86_400_000
      })
    : undefined;
  const fungicide = insertFungicideEvent({
    blockId: block.id,
    cropId: crop?.id,
    performedById: userId,
    occurredAt: Date.now() - 3_600_000,
    products: [{ pluginId: 'captan', displayName: 'Captan', fracCodes: ['M04'] }],
    conditions: { windMph: 3, tempF: 70, humidityPct: 50 } as never,
    rulesVersion: 'test',
    pluginHashes: {}
  });
  const scout = insertScoutObservation({
    blockId: block.id,
    cropId: crop?.id,
    performedById: userId,
    pest: 'aphid',
    metric: 'per-leaf',
    value: 2,
    occurredAt: Date.now() - 3_600_000
  });
  return { field, block, crop, fungicide, scout };
}

function fungicideTombstones(id: string) {
  return db
    .select()
    .from(recordDeletions)
    .where(
      withTenant(
        recordDeletions,
        and(eq(recordDeletions.recordKind, 'fungicide'), eq(recordDeletions.recordId, id))
      )
    )
    .all();
}

describe('delete cascades reach fungicide records and scout observations', () => {
  it('deleteCropCascade removes the planting with its fungicide and scout rows, tombstoning the fungicide', () => {
    const user = seedUser();
    runWithTenant(seedOwner(), () => {
      const s = seedRecords(user, true);
      expect(() => db.transaction(() => deleteCropCascade(s.crop!.id))).not.toThrow();
      expect(getFungicideEvent(s.fungicide.id)).toBeUndefined();
      expect(fungicideTombstones(s.fungicide.id)).toHaveLength(1);
      expect(getBlock(s.block.id)).toBeDefined();
    });
  });

  it('deleteBlockCascade removes the block with its fungicide and scout rows', () => {
    const user = seedUser();
    runWithTenant(seedOwner(), () => {
      const s = seedRecords(user, false);
      expect(() => db.transaction(() => deleteBlockCascade(s.block.id))).not.toThrow();
      expect(getBlock(s.block.id)).toBeUndefined();
      expect(getFungicideEvent(s.fungicide.id)).toBeUndefined();
      const tomb = fungicideTombstones(s.fungicide.id);
      expect(tomb).toHaveLength(1);
      expect(JSON.parse(tomb[0].snapshotJson).deletedFromFieldId).toBe(s.field.id);
      expect(listScoutObservations({ blockId: s.block.id })).toEqual([]);
    });
  });

  it('wipeAllData succeeds on a farm with fungicide records and scout observations', () => {
    const user = seedUser();
    const other = seedOwner();
    const kept = runWithTenant(other, () => seedRecords(user, true));
    runWithTenant(seedOwner(), () => {
      const s = seedRecords(user, true);
      const out = wipeAllData();
      expect(out.removed.fungicide_events).toBe(1);
      expect(out.removed.scout_observations).toBe(1);
      expect(getFungicideEvent(s.fungicide.id)).toBeUndefined();
      expect(getBlock(s.block.id)).toBeUndefined();
    });
    runWithTenant(other, () => {
      expect(getFungicideEvent(kept.fungicide.id)).toBeDefined();
      expect(listScoutObservations({ blockId: kept.block.id })).toHaveLength(1);
    });
  });
});
