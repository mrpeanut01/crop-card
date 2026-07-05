/**
 * #339 — harvest moisture persistence round-trip.
 *
 * `insertHarvestEvent` now threads `moisturePct` into the `moisture_pct`
 * column; `getHarvestEvent` / `listHarvestEvents` read it back. Previously
 * the moisture was gate-checked at the API then dropped, so the recorded
 * row carried no moisture. Seeds real rows via the repo (same pattern as
 * admin.recordLock.test.ts) so the migrated column is exercised.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { runWithTenant } from './tenant';
import { db } from './client';
import { owners } from './schema';
import { createField } from './fields';
import { createBlock } from './blocks';
import { insertHarvestEvent, getHarvestEvent, listHarvestEvents } from './harvestEvents';

const OWNER = 'harvest-moisture-test-owner';
const NOW = Date.now();

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

function seedBlockId(ownerId: string): string {
  const field = createField({ name: `${ownerId}-field-${randomUUID().slice(0, 6)}` });
  return createBlock({
    name: `${ownerId}-block-${randomUUID().slice(0, 6)}`,
    fieldId: field.id,
    acres: 1
  }).id;
}

describe('#339 harvest moisture persists', () => {
  it('round-trips a supplied moisturePct through insert → get', () => {
    ensureOwner(OWNER);
    const id = runWithTenant(OWNER, () => {
      const blockId = seedBlockId(OWNER);
      return insertHarvestEvent({
        blockId,
        cropPluginId: 'crop:wheat',
        occurredAt: NOW,
        quantity: '120 bu',
        lotNumber: 'LOT-Z89',
        moisturePct: 12.4
      }).id;
    });

    const back = runWithTenant(OWNER, () => getHarvestEvent(id));
    expect(back?.moisturePct).toBe(12.4);
  });

  it('leaves moisturePct undefined when the operator did not measure', () => {
    ensureOwner(OWNER);
    const id = runWithTenant(OWNER, () => {
      const blockId = seedBlockId(OWNER);
      return insertHarvestEvent({
        blockId,
        cropPluginId: 'crop:tomato',
        occurredAt: NOW
      }).id;
    });

    const back = runWithTenant(OWNER, () => getHarvestEvent(id));
    expect(back?.moisturePct).toBeUndefined();
  });

  it('surfaces moisturePct through listHarvestEvents too', () => {
    ensureOwner(OWNER);
    const { id, blockId } = runWithTenant(OWNER, () => {
      const blockId = seedBlockId(OWNER);
      const ev = insertHarvestEvent({
        blockId,
        cropPluginId: 'crop:barley',
        occurredAt: NOW,
        moisturePct: 13.0
      });
      return { id: ev.id, blockId };
    });

    const rows = runWithTenant(OWNER, () => listHarvestEvents({ blockId }));
    const row = rows.find((r) => r.id === id);
    expect(row?.moisturePct).toBe(13.0);
  });
});
