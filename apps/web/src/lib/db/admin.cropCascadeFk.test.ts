// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { owners, recordDeletions, scoutObservations, users } from './schema';
import { runWithTenant, withTenant } from './tenant';
import { createField } from './fields';
import { createBlock } from './blocks';
import { createPlanned } from './crops';
import { insertFungicideEvent, getFungicideEvent } from './fungicideEvents';
import { insertScoutObservation } from './scoutObservations';
import { deleteBlockCascade, deleteCropCascade } from './admin';

function seed() {
  const ownerId = `cropfk-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  const userId = `cropfk-u-${randomUUID()}`;
  db.insert(users)
    .values({ id: userId, email: `${userId}@cropfk.test` })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: 'F' });
    const block = createBlock({ name: 'B', fieldId: field.id, acres: 1 });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: 'crop:tomato',
      varietyDisplayName: 'Tomato'
    });
    const fung = insertFungicideEvent({
      blockId: block.id,
      cropId: crop.id,
      performedById: userId,
      occurredAt: Date.now() - 3 * 86_400_000,
      products: [{ pluginId: 'fung:test', displayName: 'F', fracCodes: ['3'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'test',
      pluginHashes: {}
    });
    const scout = insertScoutObservation({
      blockId: block.id,
      cropId: crop.id,
      performedById: userId,
      pest: 'aphid',
      metric: 'count',
      value: 3,
      occurredAt: Date.now()
    });
    return { ownerId, blockId: block.id, cropId: crop.id, fungId: fung.id, scoutId: scout.id };
  });
}

describe('planting and block deletes with fungicide and scout records', () => {
  it('deletes a planting that has a fungicide application and a scout observation', () => {
    const s = seed();
    runWithTenant(s.ownerId, () => {
      expect(() => deleteCropCascade(s.cropId)).not.toThrow();
      expect(getFungicideEvent(s.fungId)).toBeUndefined();
      const tomb = db
        .select()
        .from(recordDeletions)
        .where(withTenant(recordDeletions, eq(recordDeletions.recordId, s.fungId)))
        .all();
      expect(tomb.map((t) => t.recordKind)).toEqual(['fungicide']);
      const scout = db
        .select()
        .from(scoutObservations)
        .where(withTenant(scoutObservations, eq(scoutObservations.id, s.scoutId)))
        .all();
      expect(scout).toEqual([]);
    });
  });

  it('deletes a block that has a fungicide application and a scout observation', () => {
    const s = seed();
    runWithTenant(s.ownerId, () => {
      expect(() => deleteBlockCascade(s.blockId)).not.toThrow();
      expect(getFungicideEvent(s.fungId)).toBeUndefined();
    });
  });
});
