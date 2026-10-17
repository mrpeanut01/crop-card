import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { equipmentWaterTargets, irrigationSkips } from './schema';
import { type TenantScopedTable, runWithTenant, tenantValues, withTenant } from './tenant';
import { createBlock } from './blocks';
import { createEquipment } from './equipment';
import { createField } from './fields';

/** Every tenant-scoped table Phase 37 adds, keyed by SQL name. Test-only. */
export const PHASE_37_TABLES = {
  equipment_water_targets: equipmentWaterTargets,
  irrigation_skips: irrigationSkips
} as const;

export type Phase37Table = keyof typeof PHASE_37_TABLES;

export interface Phase37Seed {
  ownerId: string;
  rowIds: Record<Phase37Table, string>;
  fieldId: string;
  blockId: string;
  equipmentId: string;
}

/** One linked row in every Phase 37 table for `ownerId`, plus the parents
 *  they point at. */
export function seedPhase37(
  ownerId: string,
  label = `p37-${randomUUID().slice(0, 8)}`
): Phase37Seed {
  return runWithTenant(ownerId, () => {
    const now = Date.now();
    const field = createField({ name: `${label}-herbs`, kind: 'garden' });
    const block = createBlock({ name: `${label}-bed`, fieldId: field.id, acres: 0.01 });
    const timer = createEquipment({
      type: 'irrigation',
      typeId: 'drip-timer',
      label: `${label} drip timer`
    });

    const id = () => `${label}-${randomUUID()}`;
    const rowIds = {} as Record<Phase37Table, string>;
    const put = <T extends Phase37Table>(
      name: T,
      values: Omit<(typeof PHASE_37_TABLES)[T]['$inferInsert'], 'id' | 'ownerId'>
    ) => {
      const rowId = id();
      db.insert(PHASE_37_TABLES[name])
        .values(tenantValues({ ...values, id: rowId }) as never)
        .run();
      rowIds[name] = rowId;
      return rowId;
    };

    put('equipment_water_targets', {
      equipmentId: timer.id,
      fieldId: field.id,
      blockId: block.id
    });
    put('irrigation_skips', {
      equipmentId: timer.id,
      scheduledAt: new Date(now + 86_400_000),
      reason: 'turned-off-for-rain'
    });

    return {
      ownerId,
      rowIds,
      fieldId: field.id,
      blockId: block.id,
      equipmentId: timer.id
    };
  });
}

/** Ids of the active tenant's rows in one Phase 37 table. */
export function listPhase37Ids(name: Phase37Table, onlyId?: string): string[] {
  const table = PHASE_37_TABLES[name] as unknown as TenantScopedTable & {
    id: typeof irrigationSkips.id;
  };
  return (
    db
      .select({ id: table.id })
      .from(table)
      .where(withTenant(table, onlyId ? eq(table.id, onlyId) : undefined))
      .all() as Array<{ id: string }>
  ).map((r) => r.id);
}
