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
