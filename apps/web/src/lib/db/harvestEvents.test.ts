/**
 * #326 (CT-S6-004) — harvest_events.moisture_pct round-trip.
 *
 * The UC-16 kernel validates stored moisture at record time; #326 persists
 * it so inspector exports (USDA CSV, VDACS PDF) can surface it. These tests
 * pin the column read/write path so a regression that drops moisture would
 * silently blank the inspector column — a compliance defect.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { db } from './client';
import { owners, users } from './schema';
import { runWithTenant } from './tenant';
import { createField } from './fields';
import { createBlock } from './blocks';
import { insertHarvestEvent, listHarvestEvents, getHarvestEvent } from './harvestEvents';

function ensureOwner(id: string): void {
  db.insert(owners)
    .values({ id, name: id, slug: id.replace(/[^a-z0-9-]/g, '-'), billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
}

function seedBlock(ownerId: string): string {
  return runWithTenant(ownerId, () => {
    const field = createField({ name: `${ownerId}-field-${randomUUID().slice(0, 6)}` });
    const block = createBlock({
      name: `${ownerId}-block-${randomUUID().slice(0, 6)}`,
      fieldId: field.id,
      acres: 1
    });
    return block.id;
  });
}

describe('harvestEvents — moisturePct persistence (#326)', () => {
  it('round-trips a fractional moisture % through insert → list → get', () => {
    const ownerId = `hm-${randomUUID().slice(0, 6)}`;
    ensureOwner(ownerId);
    const blockId = seedBlock(ownerId);

    runWithTenant(ownerId, () => {
      const ev = insertHarvestEvent({
        blockId,
        cropPluginId: 'wheat-fixture',
        occurredAt: Date.now(),
        quantity: '30 bu',
        moisturePct: 13.5
      });
      expect(ev.moisturePct).toBe(13.5);

      const fetched = getHarvestEvent(ev.id);
      expect(fetched?.moisturePct).toBe(13.5);

      const listed = listHarvestEvents({ blockId }).find((h) => h.id === ev.id);
      expect(listed?.moisturePct).toBe(13.5);
    });
  });

  it('leaves moisturePct undefined when not supplied (informational, not a gate)', () => {
    const ownerId = `hm2-${randomUUID().slice(0, 6)}`;
    ensureOwner(ownerId);
    const blockId = seedBlock(ownerId);

    runWithTenant(ownerId, () => {
      const ev = insertHarvestEvent({
        blockId,
        cropPluginId: 'lettuce-fixture',
        occurredAt: Date.now(),
        quantity: '8 lb'
      });
      expect(ev.moisturePct).toBeUndefined();
      expect(getHarvestEvent(ev.id)?.moisturePct).toBeUndefined();
    });
  });
});
