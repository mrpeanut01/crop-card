// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from './client';
import { equipment, owners, users } from './schema';
import { runWithTenant, tenantValues } from './tenant';
import { createField } from './fields';
import { createBlock } from './blocks';
import { getFungicideEvent, insertFungicideEvent } from './fungicideEvents';
import { deleteEquipmentCascade, equipmentHasSprayRecords } from './admin';
import { insertSprayEvent } from './sprayEvents';

function seed() {
  const ownerId = `eqdel-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  const userId = `eqdel-u-${randomUUID()}`;
  db.insert(users)
    .values({ id: userId, email: `${userId}@eqdel.test` })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: 'F' });
    const block = createBlock({ name: 'B', fieldId: field.id, acres: 1 });
    const sprayerId = `eqdel-s-${randomUUID()}`;
    db.insert(equipment)
      .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Sprayer' }))
      .run();
    return { ownerId, userId, blockId: block.id, sprayerId };
  });
}

describe('deleting a sprayer', () => {
  it('reports a sprayer that a fungicide application names, and leaves the record alone', () => {
    const s = seed();
    runWithTenant(s.ownerId, () => {
      expect(equipmentHasSprayRecords(s.sprayerId)).toBe(false);
      const fung = insertFungicideEvent({
        blockId: s.blockId,
        sprayerId: s.sprayerId,
        performedById: s.userId,
        occurredAt: Date.now(),
        products: [{ pluginId: 'fung:test', displayName: 'F', fracCodes: ['3'] }],
        conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
        rulesVersion: 'test',
        pluginHashes: {}
      });
      expect(equipmentHasSprayRecords(s.sprayerId)).toBe(true);
      expect(getFungicideEvent(fung.id)?.sprayerId).toBe(s.sprayerId);
    });
  });

  it('lets a sprayer with no records go', () => {
    const s = seed();
    runWithTenant(s.ownerId, () => {
      expect(() => deleteEquipmentCascade(s.sprayerId)).not.toThrow();
    });
  });

  it('reports a sprayer that herbicide spray records still name', () => {
    const s = seed();
    runWithTenant(s.ownerId, () => {
      insertSprayEvent({
        blockId: s.blockId,
        sprayerId: s.sprayerId,
        performedById: s.userId,
        occurredAt: Date.now(),
        products: [{ pluginId: 'herb:test', chemistryClasses: ['glyphosate'] }],
        conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
        rulesVersion: 'test',
        pluginHashes: {}
      });
      expect(equipmentHasSprayRecords(s.sprayerId)).toBe(true);
    });
  });
});
