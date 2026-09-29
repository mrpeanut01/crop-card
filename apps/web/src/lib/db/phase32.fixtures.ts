import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './client';
import {
  animalCarePlans,
  animalFlagChanges,
  animalGroups,
  animalHealthEvents,
  animalLocations,
  animalProductionLogs,
  animalStatusEvents,
  animals,
  blockProtections,
  grazingAttestations,
  holdCorrections,
  irrigationEvents,
  ledgerEntries,
  rainGaugeReadings,
  seedStarts,
  taskTimeEntries
} from './schema';
import { type TenantScopedTable, tenantValues, withTenant } from './tenant';
import { createBlock } from './blocks';
import { createPlanned } from './crops';
import { createField } from './fields';
import { createStockItem, receiveLot } from './stock';
import { createTask } from './tasks';

/** Every table Phase 32 adds, keyed by SQL name. Test-only. */
export const PHASE_32_TABLES = {
  animal_groups: animalGroups,
  animals,
  animal_locations: animalLocations,
  animal_health_events: animalHealthEvents,
  animal_production_logs: animalProductionLogs,
  animal_status_events: animalStatusEvents,
  grazing_attestations: grazingAttestations,
  animal_flag_changes: animalFlagChanges,
  animal_care_plans: animalCarePlans,
  seed_starts: seedStarts,
  block_protections: blockProtections,
  irrigation_events: irrigationEvents,
  rain_gauge_readings: rainGaugeReadings,
  task_time_entries: taskTimeEntries,
  ledger_entries: ledgerEntries,
  hold_corrections: holdCorrections
} as const;

export type Phase32Table = keyof typeof PHASE_32_TABLES;

export interface Phase32Seed {
  rowIds: Record<Phase32Table, string>;
  fieldId: string;
  stockLotId: string;
  animalId: string;
  groupId: string;
}

/** One linked row in every Phase 32 table for the active tenant. */
export function seedPhase32Rows(label: string): Phase32Seed {
  const now = Date.now();
  const field = createField({ name: `${label}-pasture`, kind: 'pasture' });
  const block = createBlock({ name: `${label}-bed`, fieldId: field.id, acres: 1 });
  const crop = createPlanned({
    blockId: block.id,
    cropPluginId: 'crop:tomato',
    varietyDisplayName: 'Roma'
  });
  const item = createStockItem({
    category: 'seed',
    displayName: `${label}-seed`,
    defaultUnit: 'seeds'
  });
  const lot = receiveLot({ stockItemId: item.id, receivedQuantity: 200, unit: 'seeds' });
  const task = createTask({
    title: `${label}-task`,
    kind: 'primary',
    cropId: crop.id,
    blockId: block.id,
    scheduledFor: now
  });

  const id = () => `${label}-${randomUUID()}`;
  const rowIds = {} as Record<Phase32Table, string>;
  const put = <T extends Phase32Table>(
    name: T,
    values: Omit<(typeof PHASE_32_TABLES)[T]['$inferInsert'], 'id' | 'ownerId'>
  ) => {
    const rowId = id();
    db.insert(PHASE_32_TABLES[name])
      .values(tenantValues({ ...values, id: rowId }) as never)
      .run();
    rowIds[name] = rowId;
    return rowId;
  };

  const groupId = put('animal_groups', {
    name: `${label}-layers`,
    speciesId: 'chicken',
    headCount: 24,
    housingFieldId: field.id
  });
  const animalId = put('animals', {
    groupId,
    speciesId: 'chicken',
    name: `${label}-hen`,
    housingFieldId: field.id
  });
  put('animal_locations', {
    subjectType: 'group',
    subjectId: groupId,
    fieldId: field.id,
    fromMs: new Date(now)
  });
  put('animal_health_events', {
    subjectType: 'animal',
    subjectId: animalId,
    kind: 'deworm',
    stockItemId: item.id,
    administeredAt: new Date(now),
    foodProducingAtRecord: true
  });
  put('animal_production_logs', {
    subjectType: 'group',
    subjectId: groupId,
    kind: 'eggs',
    quantity: 18,
    unit: 'egg',
    occurredAt: new Date(now),
    use: 'discard'
  });
  put('animal_status_events', {
    subjectType: 'group',
    subjectId: groupId,
    status: 'died',
    occurredAt: new Date(now),
    headCountDelta: -1
  });
  put('grazing_attestations', {
    fieldId: field.id,
    grazeDays: 7,
    reason: 'Read from the label'
  });
  put('animal_flag_changes', {
    subjectType: 'animal',
    subjectId: animalId,
    flag: 'food_producing',
    oldValue: true,
    newValue: true,
    reason: 'Laying hen'
  });
  put('animal_care_plans', {
    subjectType: 'group',
    subjectId: groupId,
    kind: 'deworm',
    title: 'Deworm the flock',
    intervalDays: 90,
    provenance: 'manual'
  });
  put('seed_starts', {
    cropId: crop.id,
    sownAt: new Date(now),
    cells: 72,
    stockLotId: lot.id,
    locationAreaId: field.id
  });
  put('block_protections', {
    blockId: block.id,
    kind: 'row-cover',
    provenance: 'manual'
  });
  put('irrigation_events', {
    fieldId: field.id,
    blockId: block.id,
    occurredAt: new Date(now),
    inches: 0.5
  });
  put('rain_gauge_readings', {
    fieldId: field.id,
    readAt: new Date(now),
    inches: 1.2
  });
  put('task_time_entries', {
    taskId: task.id,
    cropId: crop.id,
    blockId: block.id,
    fieldId: field.id,
    minutes: 30
  });
  put('ledger_entries', {
    kind: 'expense',
    occurredAt: new Date(now),
    amountCents: 1299,
    cropId: crop.id,
    blockId: block.id,
    fieldId: field.id,
    animalId,
    animalGroupId: groupId,
    stockLotId: lot.id
  });

  put('hold_corrections', {
    recordKind: 'animal-health',
    recordId: randomUUID(),
    reason: 'Entered on the wrong animal',
    diffJson: '{"holds":[],"coverage":[]}',
    diffHash: 'test'
  });

  return { rowIds, fieldId: field.id, stockLotId: lot.id, animalId, groupId };
}

/** Ids of the active tenant's rows in one Phase 32 table. */
export function listPhase32Ids(name: Phase32Table, onlyId?: string): string[] {
  const table = PHASE_32_TABLES[name] as unknown as TenantScopedTable & {
    id: typeof animals.id;
  };
  return (
    db
      .select({ id: table.id })
      .from(table)
      .where(withTenant(table, onlyId ? eq(table.id, onlyId) : undefined))
      .all() as Array<{ id: string }>
  ).map((r) => r.id);
}
