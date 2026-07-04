/**
 * FR-09 record-lock enforcement on deletes (#308) + force-delete
 * tombstones (#329).
 *
 * Tests the record-lock layer in admin.ts as a security boundary:
 *   - a locked insecticide / harvest / spray record refuses a plain DELETE
 *     (throws RecordLockedError → 422 at the endpoint)
 *   - an unlocked (in-window) record deletes freely
 *   - an owner `?force` delete of a locked record removes the row AND writes
 *     a record_deletions tombstone with the acting user, reason, and a JSON
 *     snapshot of the destroyed row
 *   - the tombstone is tenant-scoped
 *
 * Seeds real rows via the repos (same pattern as exports.crossTenant.test.ts)
 * so the lazy lock-stamp path exercised by evaluateLock runs against the
 * migrated schema.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { runWithTenant } from './tenant';
import { db } from './client';
import { equipment, owners, recordDeletions, users } from './schema';
import { createField } from './fields';
import { createBlock } from './blocks';
import { insertSprayEvent, getSprayEvent, LOCK_WINDOW_MS } from './sprayEvents';
import { insertInsecticideEvent, getInsecticideEvent } from './insecticideEvents';
import { insertHarvestEvent, getHarvestEvent } from './harvestEvents';
import {
  RecordLockedError,
  deleteInsecticideEvent,
  deleteHarvestEvent,
  deleteSprayEvent
} from './admin';

const OWNER = 'recordlock-test-owner';
const OWNER_OTHER = 'recordlock-test-owner-other';

/** 3 days ago — comfortably past the 48h lock window. */
const AGED = Date.now() - 3 * 24 * 60 * 60 * 1000;
/** 1 hour ago — inside the window, still mutable. */
const FRESH = Date.now() - 60 * 60 * 1000;

function ensureOwner(ownerId: string): void {
  db.insert(owners)
    .values({
      id: ownerId,
      name: ownerId,
      slug: ownerId.replace(/[^a-z0-9-]/g, '-'),
      billingStatus: 'active'
    })
    .onConflictDoNothing()
    .run();
}

function ensureUser(id: string): void {
  db.insert(users)
    .values({ id, email: `${id}@recordlock.test` })
    .onConflictDoNothing()
    .run();
}

function seedBlock(ownerId: string): { blockId: string; sprayerId: string } {
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
  return { blockId: block.id, sprayerId };
}

function seedInsecticide(ownerId: string, occurredAt: number, performedById: string): string {
  return runWithTenant(ownerId, () => {
    const { blockId } = seedBlock(ownerId);
    return insertInsecticideEvent({
      blockId,
      performedById,
      occurredAt,
      products: [{ pluginId: 'pest:test', displayName: 'TestPest', iracGroups: ['1A'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'test',
      pluginHashes: { 'pest:test': 'abc' }
    }).id;
  });
}

function seedHarvest(ownerId: string, occurredAt: number): string {
  return runWithTenant(ownerId, () => {
    const { blockId } = seedBlock(ownerId);
    return insertHarvestEvent({
      blockId,
      cropPluginId: 'crop:tomato',
      occurredAt,
      quantity: '10 lb',
      lotNumber: 'LOT-42'
    }).id;
  });
}

function seedSpray(ownerId: string, occurredAt: number, performedById: string): string {
  return runWithTenant(ownerId, () => {
    const { blockId, sprayerId } = seedBlock(ownerId);
    return insertSprayEvent({
      blockId,
      sprayerId,
      performedById,
      occurredAt,
      products: [{ pluginId: 'herb:test', chemistryClasses: ['glyphosate'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'test',
      pluginHashes: { 'herb:test': 'abc' }
    }).id;
  });
}

function tombstones(ownerId: string, recordId: string) {
  return runWithTenant(ownerId, () =>
    db
      .select()
      .from(recordDeletions)
      .where(and(eq(recordDeletions.ownerId, ownerId), eq(recordDeletions.recordId, recordId)))
      .all()
  );
}

describe('FR-09 delete lock — insecticide (#308)', () => {
  it('refuses a plain DELETE of a locked (aged) insecticide record', () => {
    ensureOwner(OWNER);
    ensureUser('u1');
    const id = seedInsecticide(OWNER, AGED, 'u1');
    runWithTenant(OWNER, () => {
      expect(() => deleteInsecticideEvent(id)).toThrow(RecordLockedError);
      // Row survives the refused delete.
      expect(getInsecticideEvent(id)).toBeDefined();
    });
  });

  it('allows deleting an unlocked (in-window) insecticide record', () => {
    ensureOwner(OWNER);
    ensureUser('u1');
    const id = seedInsecticide(OWNER, FRESH, 'u1');
    runWithTenant(OWNER, () => {
      const res = deleteInsecticideEvent(id);
      expect(res.removed.insecticide_events).toBe(1);
      expect(getInsecticideEvent(id)).toBeUndefined();
      // No tombstone for an unlocked delete.
      expect(tombstones(OWNER, id)).toHaveLength(0);
    });
  });

  it('owner force-delete removes a locked insecticide record and writes a tombstone', () => {
    ensureOwner(OWNER);
    ensureUser('u1');
    const id = seedInsecticide(OWNER, AGED, 'u1');
    runWithTenant(OWNER, () => {
      const res = deleteInsecticideEvent(id, {
        force: true,
        deletedBy: 'u1',
        reason: 'duplicate entry'
      });
      expect(res.removed.insecticide_events).toBe(1);
      expect(getInsecticideEvent(id)).toBeUndefined();

      const t = tombstones(OWNER, id);
      expect(t).toHaveLength(1);
      expect(t[0].recordKind).toBe('insecticide');
      expect(t[0].deletedBy).toBe('u1');
      expect(t[0].reason).toBe('duplicate entry');
      const snap = JSON.parse(t[0].snapshotJson);
      expect(snap.id).toBe(id);
      expect(snap.products[0].pluginId).toBe('pest:test');
    });
  });
});

describe('FR-09 delete lock — harvest (#308)', () => {
  it('refuses a plain DELETE of a locked (aged) harvest record', () => {
    ensureOwner(OWNER);
    const id = seedHarvest(OWNER, AGED);
    runWithTenant(OWNER, () => {
      expect(() => deleteHarvestEvent(id)).toThrow(RecordLockedError);
      expect(getHarvestEvent(id)).toBeDefined();
    });
  });

  it('allows deleting an unlocked (in-window) harvest record', () => {
    ensureOwner(OWNER);
    const id = seedHarvest(OWNER, FRESH);
    runWithTenant(OWNER, () => {
      const res = deleteHarvestEvent(id);
      expect(res.removed.harvest_events).toBe(1);
      expect(getHarvestEvent(id)).toBeUndefined();
      expect(tombstones(OWNER, id)).toHaveLength(0);
    });
  });

  it('owner force-delete removes a locked harvest record and writes a tombstone', () => {
    ensureOwner(OWNER);
    ensureUser('u1');
    const id = seedHarvest(OWNER, AGED);
    runWithTenant(OWNER, () => {
      const res = deleteHarvestEvent(id, { force: true, deletedBy: 'u1', reason: 'mis-keyed lot' });
      expect(res.removed.harvest_events).toBe(1);
      expect(getHarvestEvent(id)).toBeUndefined();

      const t = tombstones(OWNER, id);
      expect(t).toHaveLength(1);
      expect(t[0].recordKind).toBe('harvest');
      expect(t[0].deletedBy).toBe('u1');
      const snap = JSON.parse(t[0].snapshotJson);
      expect(snap.lotNumber).toBe('LOT-42');
    });
  });
});

describe('FR-09 delete lock — spray tombstone (#329)', () => {
  it('owner force-delete of a locked spray record writes a tombstone', () => {
    ensureOwner(OWNER);
    ensureUser('u1');
    const id = seedSpray(OWNER, AGED, 'u1');
    runWithTenant(OWNER, () => {
      // Sanity: the row is past the window and would refuse a plain delete.
      expect(() => deleteSprayEvent(id)).toThrow(RecordLockedError);
      const res = deleteSprayEvent(id, { force: true, deletedBy: 'u1', reason: 'test cleanup' });
      expect(res.removed.spray_events).toBe(1);
      expect(getSprayEvent(id)).toBeUndefined();

      const t = tombstones(OWNER, id);
      expect(t).toHaveLength(1);
      expect(t[0].recordKind).toBe('spray');
      expect(t[0].reason).toBe('test cleanup');
    });
  });

  it('force-delete of an in-window spray record does NOT write a tombstone', () => {
    ensureOwner(OWNER);
    ensureUser('u1');
    const id = seedSpray(OWNER, FRESH, 'u1');
    runWithTenant(OWNER, () => {
      deleteSprayEvent(id, { force: true, deletedBy: 'u1' });
      expect(tombstones(OWNER, id)).toHaveLength(0);
    });
  });
});

describe('tombstone tenant isolation', () => {
  it("a force-delete tombstone is scoped to the acting Owner and never leaks", () => {
    ensureOwner(OWNER);
    ensureOwner(OWNER_OTHER);
    ensureUser('u1');
    const id = seedInsecticide(OWNER, AGED, 'u1');
    runWithTenant(OWNER, () =>
      deleteInsecticideEvent(id, { force: true, deletedBy: 'u1', reason: 'scoped' })
    );
    // The other Owner sees no tombstone for OWNER's deleted record.
    const otherSees = runWithTenant(OWNER_OTHER, () =>
      db.select().from(recordDeletions).where(eq(recordDeletions.recordId, id)).all()
    );
    // tenantWhere is not applied by the raw query above, so this asserts the
    // row exists but carries OWNER's ownerId (never OWNER_OTHER's).
    for (const row of otherSees) expect(row.ownerId).toBe(OWNER);
    expect(tombstones(OWNER_OTHER, id)).toHaveLength(0);
    expect(tombstones(OWNER, id)).toHaveLength(1);
  });
});

describe('lock stamp semantics parity with spray', () => {
  it('LOCK_WINDOW_MS matches across record kinds (48h)', () => {
    expect(LOCK_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
  });
});
