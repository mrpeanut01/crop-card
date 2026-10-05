/** Test-only seeding and request helpers for the Phase 36 edit-conflict
 *  tests. Callers mock `$lib/server/auth` themselves. */
import { randomUUID } from 'node:crypto';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned, setSchedule, updateDetails } from '$lib/db/crops';
import { createTask } from '$lib/db/tasks';
import { createStockItem, receiveLot } from '$lib/db/stock';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

export const APR_1 = Date.UTC(2027, 3, 1);
export const DAY = 86_400_000;

export interface EditFarm {
  ownerId: string;
  blockA: string;
  blockB: string;
  cropId: string;
  taskId: string;
  helperId: string;
  otherHelperId: string;
}

function seedMember(ownerId: string, role: 'helper' | 'owner'): string {
  const userId = `${ownerId}-${role}-${randomUUID().slice(0, 6)}`;
  db.insert(users)
    .values({ id: userId, email: `${userId}@edits.test` })
    .run();
  db.insert(helperAssignments)
    .values({ ownerId, userId, roleWithinOwner: role, status: 'active' })
    .run();
  return userId;
}

export function seedEditFarm(prefix = 'edits'): EditFarm {
  const ownerId = `${prefix}-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  const helperId = seedMember(ownerId, 'helper');
  const otherHelperId = seedMember(ownerId, 'helper');
  return runWithTenant(ownerId, () => {
    const field = createField({ name: 'North', kind: 'field', widthFt: 100, lengthFt: 200 });
    const blockA = createBlock({ fieldId: field.id, name: 'Bed A' }).id;
    const blockB = createBlock({ fieldId: field.id, name: 'Bed B' }).id;
    const crop = createPlanned({
      blockId: blockA,
      cropPluginId: 'lettuce-black-seeded-simpson',
      varietyDisplayName: 'Lettuce'
    });
    setSchedule(crop.id, { plantingDate: APR_1 });
    updateDetails(crop.id, { quantityPlanted: 10, quantityUnit: 'ft', harvestUseCases: null });
    const task = createTask({
      title: 'Weed bed A',
      body: 'Hand hoe',
      kind: 'primary',
      blockId: blockA,
      scheduledFor: APR_1 + 3 * DAY
    });
    return { ownerId, blockA, blockB, cropId: crop.id, taskId: task.id, helperId, otherHelperId };
  });
}

export interface GardenEditFarm {
  ownerId: string;
  bed1: string;
  bed2: string;
  cropId: string;
  stockId: string;
  ownerUserId: string;
}

export const FP = { x_in: 0, y_in: 0, w_in: 24, l_in: 24 } as const;

/** A garden Area with two sized beds, a planned planting placed in bed 1
 *  and a seed stock item with 10 on hand. */
export function seedGardenEditFarm(prefix = 'edits-garden'): GardenEditFarm {
  const ownerId = `${prefix}-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  const ownerUserId = seedMember(ownerId, 'owner');
  return runWithTenant(ownerId, () => {
    const area = createField({ name: 'Kitchen', kind: 'garden', widthFt: 20, lengthFt: 30 });
    const bed = (name: string, xFt: number) =>
      createBlock({
        name,
        fieldId: area.id,
        kind: 'bed',
        widthFt: 4,
        lengthFt: 8,
        xFt,
        yFt: 3,
        bedStyle: 'raised'
      }).id;
    const bed1 = bed('Bed 1', 2);
    const bed2 = bed('Bed 2', 8);
    const crop = createPlanned({
      blockId: bed1,
      cropPluginId: 'lettuce-black-seeded-simpson',
      varietyDisplayName: 'Lettuce',
      plantingDate: APR_1,
      placement: {
        footprint: { ...FP },
        spacingIn: null,
        rowSpacingIn: null,
        spacingPattern: 'square',
        plantCount: null,
        plantCountProvenance: null
      }
    });
    const item = createStockItem({
      category: 'seed',
      displayName: 'Lettuce seed',
      defaultUnit: 'count'
    });
    receiveLot({ stockItemId: item.id, receivedQuantity: 10, unit: 'count' });
    return { ownerId, bed1, bed2, cropId: crop.id, stockId: item.id, ownerUserId };
  });
}

export function postEvent(path: string, id: string, body: unknown, opts: PatchOpts = {}) {
  const url = new URL(`http://localhost${path.replace(':id', id)}`);
  return {
    params: { id },
    url,
    locals: { locale: opts.locale ?? 'en' },
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as never;
}

export interface PatchOpts {
  clientRecordId?: string;
  locale?: string;
}

export function patchEvent(path: string, id: string, body: unknown, opts: PatchOpts = {}) {
  const url = new URL(`http://localhost${path}/${id}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.clientRecordId) headers[CLIENT_RECORD_HEADER] = opts.clientRecordId;
  return {
    params: { id },
    url,
    locals: { locale: opts.locale ?? 'en' },
    request: new Request(url, { method: 'PATCH', headers, body: JSON.stringify(body) })
  } as never;
}
