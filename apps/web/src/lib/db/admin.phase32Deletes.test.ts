// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { animalHealthEvents, animalLocations, fields, owners } from './schema';
import { runWithTenant, withTenant } from './tenant';
import { deleteFieldCascade, deleteStockItemCascade } from './admin';
import { seedPhase32Rows } from './phase32.fixtures';

function seedOwner(): string {
  const id = `p32del-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

describe('Phase 32 rows and per-row deletes', () => {
  it('deletes an Area that animals have been moved through, with its location history', () => {
    runWithTenant(seedOwner(), () => {
      const seeded = seedPhase32Rows('field-delete');
      const out = deleteFieldCascade(seeded.fieldId);
      expect(out.removed.fields).toBe(1);
      expect(out.removed.animal_locations).toBe(1);
      expect(
        db
          .select()
          .from(animalLocations)
          .where(withTenant(animalLocations, eq(animalLocations.fieldId, seeded.fieldId)))
          .all()
      ).toEqual([]);
      expect(
        db
          .select()
          .from(fields)
          .where(withTenant(fields, eq(fields.id, seeded.fieldId)))
          .all()
      ).toEqual([]);
    });
  });

  it('keeps an animal treatment when the inventory item it used is deleted', () => {
    runWithTenant(seedOwner(), () => {
      const seeded = seedPhase32Rows('stock-delete');
      const id = seeded.rowIds.animal_health_events;
      const before = db
        .select()
        .from(animalHealthEvents)
        .where(withTenant(animalHealthEvents, eq(animalHealthEvents.id, id)))
        .get();
      expect(before?.stockItemId).toBeTruthy();

      const out = deleteStockItemCascade(before!.stockItemId!);
      expect(out.removed.stock_items).toBe(1);
      const after = db
        .select()
        .from(animalHealthEvents)
        .where(withTenant(animalHealthEvents, eq(animalHealthEvents.id, id)))
        .get();
      expect(after).toMatchObject({ id, stockItemId: null, kind: 'deworm' });
    });
  });
});
