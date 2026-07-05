/**
 * #320 / CT-S5-003 — conditions provenance round-trip.
 *
 * A spray_event must carry an honest `conditionsProvenance` flag so a
 * synthetic 5 mph / 70 °F default is never presented as a measured
 * reading. The flag rides inside the `conditionsJson` blob (no schema
 * column / migration), so this exercises the insert + read path:
 *   • measured readings persist as `'measured'`
 *   • omitted flag / synthetic defaults persist + read back as `'default'`
 *   • legacy rows written before the flag existed coalesce to `'default'`
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { runWithTenant } from './tenant';
import { db } from './client';
import { equipment, owners, sprayEvents, users } from './schema';
import { createField } from './fields';
import { createBlock } from './blocks';
import { insertSprayEvent, listSprayEvents } from './sprayEvents';

const OWNER = 'prov-test-owner';

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
    .values({ id, email: `${id}@prov.test` })
    .onConflictDoNothing()
    .run();
}

function seedBlockAndSprayer(ownerId: string): { blockId: string; sprayerId: string } {
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

describe('spray_event conditions provenance (#320)', () => {
  it('persists a measured reading as measured', () => {
    ensureOwner(OWNER);
    ensureUser('u-prov');
    const inserted = runWithTenant(OWNER, () => {
      const { blockId, sprayerId } = seedBlockAndSprayer(OWNER);
      return insertSprayEvent({
        blockId,
        sprayerId,
        performedById: 'u-prov',
        occurredAt: Date.now(),
        products: [{ pluginId: 'herb:test', chemistryClasses: ['glyphosate'] }],
        conditions: {
          windMph: 20,
          tempF: 88,
          rainForecastMmNext24h: 0,
          conditionsProvenance: 'measured'
        },
        rulesVersion: 'test',
        pluginHashes: { 'herb:test': 'abc' }
      });
    });
    expect(inserted.conditions.conditionsProvenance).toBe('measured');
    expect(inserted.conditions.windMph).toBe(20);

    const read = runWithTenant(OWNER, () => listSprayEvents({ blockId: inserted.blockId }));
    const row = read.find((e) => e.id === inserted.id);
    expect(row?.conditions.conditionsProvenance).toBe('measured');
  });

  it('persists an omitted flag as default (synthetic values are not measured)', () => {
    ensureOwner(OWNER);
    ensureUser('u-prov');
    const inserted = runWithTenant(OWNER, () => {
      const { blockId, sprayerId } = seedBlockAndSprayer(OWNER);
      return insertSprayEvent({
        blockId,
        sprayerId,
        performedById: 'u-prov',
        occurredAt: Date.now(),
        products: [{ pluginId: 'herb:test', chemistryClasses: ['glyphosate'] }],
        // No conditionsProvenance — the synthetic 5 mph / 70 °F defaults.
        conditions: { windMph: 5, tempF: 70, rainForecastMmNext24h: 0 },
        rulesVersion: 'test',
        pluginHashes: { 'herb:test': 'abc' }
      });
    });

    const read = runWithTenant(OWNER, () => listSprayEvents({ blockId: inserted.blockId }));
    const row = read.find((e) => e.id === inserted.id);
    expect(row?.conditions.conditionsProvenance).toBe('default');
  });

  it('coalesces a legacy row with no provenance flag to default on read', () => {
    ensureOwner(OWNER);
    ensureUser('u-prov');
    const id = randomUUID();
    const { blockId, sprayerId } = runWithTenant(OWNER, () => seedBlockAndSprayer(OWNER));
    // Simulate a pre-#320 row: conditionsJson has no conditionsProvenance key.
    db.insert(sprayEvents)
      .values({
        id,
        ownerId: OWNER,
        blockId,
        sprayerId,
        performedById: 'u-prov',
        occurredAt: new Date(),
        productsJson: JSON.stringify([{ pluginId: 'herb:test', chemistryClasses: ['glyphosate'] }]),
        conditionsJson: JSON.stringify({ windMph: 5, tempF: 70, rainForecastMmNext24h: 0 }),
        rulesVersion: 'test',
        pluginHashesJson: JSON.stringify({ 'herb:test': 'abc' }),
        customRateOverride: false
      })
      .run();

    const read = runWithTenant(OWNER, () => listSprayEvents({ blockId }));
    const row = read.find((e) => e.id === id);
    expect(row?.conditions.conditionsProvenance).toBe('default');
  });
});
