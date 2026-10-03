// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ role: 'owner', id: 'edit-user' }));
vi.mock('$lib/server/auth', () => ({
  currentUser: () => ({ id: auth.id, role: auth.role, impersonating: false })
}));

import { runWithTenant } from '$lib/db/tenant';
import { getCrop } from '$lib/db/crops';
import { getTask, listTasks } from '$lib/db/tasks';
import { PATCH as patchCropRoute } from '../../routes/api/crops/[id]/+server';
import { PATCH as patchTaskRoute } from '../../routes/api/tasks/[id]/+server';
import { APR_1, DAY, patchEvent, seedEditFarm, type PatchOpts } from './editConflict.fixtures';
import { isEditConflictBody } from './conflict';

const patchCrop = (id: string, body: unknown, opts?: PatchOpts) =>
  patchCropRoute(patchEvent('/api/crops', id, body, opts)) as Promise<Response>;
const patchTask = (id: string, body: unknown, opts?: PatchOpts) =>
  patchTaskRoute(patchEvent('/api/tasks', id, body, opts)) as Promise<Response>;

describe('PATCH /api/crops/:id edit-details with base', () => {
  it('saves when base matches and answers 409 with both versions when stale', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      const ok = await patchCrop(farm.cropId, {
        action: 'edit-details',
        varietyDisplayName: 'Romaine',
        base: { varietyDisplayName: 'Lettuce' }
      });
      expect(ok.status).toBe(200);
      expect((await ok.json()).crop.varietyDisplayName).toBe('Romaine');

      const stale = await patchCrop(farm.cropId, {
        action: 'edit-details',
        varietyDisplayName: 'Butterhead',
        quantityPlanted: 25,
        base: { varietyDisplayName: 'Lettuce', quantityPlanted: 10 }
      });
      expect(stale.status).toBe(409);
      const body = await stale.json();
      expect(isEditConflictBody(body)).toBe(true);
      expect(body).toMatchObject({
        code: 'EDIT_CONFLICT',
        target: 'planting',
        id: farm.cropId,
        action: 'edit-details',
        error: 'Someone else changed this while you were editing. Nothing was saved.',
        fields: [
          { field: 'varietyDisplayName', base: 'Lettuce', mine: 'Butterhead', theirs: 'Romaine' }
        ]
      });
      expect(body.current).toEqual({
        varietyDisplayName: 'Romaine',
        quantityPlanted: 10,
        quantityUnit: 'ft',
        harvestUseCases: null,
        plantingDate: APR_1,
        blockId: farm.blockA
      });
      const crop = getCrop(farm.cropId)!;
      expect(crop.varietyDisplayName).toBe('Romaine');
      expect(crop.quantityPlanted).toBe(10);
    });
  });

  it('is not a conflict when both devices made the same change', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      await patchCrop(farm.cropId, { action: 'edit-details', varietyDisplayName: 'Romaine' });
      const same = await patchCrop(farm.cropId, {
        action: 'edit-details',
        varietyDisplayName: 'Romaine',
        quantityPlanted: 12,
        base: { varietyDisplayName: 'Lettuce', quantityPlanted: 10 }
      });
      expect(same.status).toBe(200);
      expect(getCrop(farm.cropId)?.quantityPlanted).toBe(12);
    });
  });

  it('does not check fields sent without base (API agents, old clients)', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      await patchCrop(farm.cropId, { action: 'edit-details', varietyDisplayName: 'Romaine' });
      const res = await patchCrop(farm.cropId, {
        action: 'edit-details',
        varietyDisplayName: 'Cos'
      });
      expect(res.status).toBe(200);
      expect(getCrop(farm.cropId)?.varietyDisplayName).toBe('Cos');
    });
  });

  it('compares harvest windows as a set and answers in Spanish', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      await patchCrop(farm.cropId, { action: 'edit-details', harvestUseCases: ['baby', 'head'] });
      const reordered = await patchCrop(farm.cropId, {
        action: 'edit-details',
        harvestUseCases: ['baby'],
        base: { harvestUseCases: ['head', 'baby'] }
      });
      expect(reordered.status).toBe(200);
      const stale = await patchCrop(
        farm.cropId,
        { action: 'edit-details', harvestUseCases: null, base: { harvestUseCases: ['head'] } },
        { locale: 'es' }
      );
      expect(stale.status).toBe(409);
      expect((await stale.json()).error).toBe(
        'Otra persona cambió esto mientras lo editabas. No se guardó nada.'
      );
    });
  });

  it('refuses a base field the action does not change', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      const res = await patchCrop(farm.cropId, {
        action: 'edit-details',
        varietyDisplayName: 'Romaine',
        base: { plantingDate: APR_1 }
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('PATCH /api/crops/:id set-schedule with base', () => {
  it('refuses a stale date move and leaves tasks where they were', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      await patchCrop(farm.cropId, { action: 'set-schedule', plantingDate: APR_1 + 7 * DAY });
      const tasksBefore = listTasks({}).map((t) => [t.id, t.scheduledFor]);
      const stale = await patchCrop(farm.cropId, {
        action: 'set-schedule',
        plantingDate: APR_1 + 14 * DAY,
        blockId: farm.blockB,
        base: { plantingDate: APR_1, blockId: farm.blockA }
      });
      expect(stale.status).toBe(409);
      const body = await stale.json();
      expect(body.fields).toEqual([
        { field: 'plantingDate', base: APR_1, mine: APR_1 + 14 * DAY, theirs: APR_1 + 7 * DAY }
      ]);
      const crop = getCrop(farm.cropId)!;
      expect(crop.plantingDate).toBe(APR_1 + 7 * DAY);
      expect(crop.blockId).toBe(farm.blockA);
      expect(listTasks({}).map((t) => [t.id, t.scheduledFor])).toEqual(tasksBefore);
    });
  });

  it('saves a block move whose base matches, and a clear to null', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      const moved = await patchCrop(farm.cropId, {
        action: 'set-schedule',
        plantingDate: APR_1,
        blockId: farm.blockB,
        base: { plantingDate: APR_1, blockId: farm.blockA }
      });
      expect(moved.status).toBe(200);
      expect(getCrop(farm.cropId)?.blockId).toBe(farm.blockB);
      const cleared = await patchCrop(farm.cropId, {
        action: 'set-schedule',
        plantingDate: null,
        base: { plantingDate: APR_1 }
      });
      expect(cleared.status).toBe(200);
      expect(getCrop(farm.cropId)?.plantingDate).toBeNull();
      const stale = await patchCrop(farm.cropId, {
        action: 'set-schedule',
        plantingDate: APR_1 + DAY,
        base: { plantingDate: APR_1 }
      });
      expect(stale.status).toBe(409);
      expect((await stale.json()).fields[0]).toMatchObject({ field: 'plantingDate', theirs: null });
    });
  });

  it('never refuses status actions, even with a stale base', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      await patchCrop(farm.cropId, { action: 'edit-details', varietyDisplayName: 'Romaine' });
      for (const action of ['mark-harvested', 'reactivate', 'mark-failed', 'archive']) {
        const res = await patchCrop(farm.cropId, {
          action,
          base: { varietyDisplayName: 'Lettuce' }
        });
        expect(res.status).toBe(200);
      }
      expect(getCrop(farm.cropId)?.status).toBe('archived');
    });
  });
});

describe('PATCH /api/tasks/:id with base', () => {
  it('checks edit, reschedule and assign', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      await patchTask(farm.taskId, { action: 'edit', title: 'Weed both beds' });
      const staleEdit = await patchTask(farm.taskId, {
        action: 'edit',
        title: 'Weed A',
        body: 'Use the wheel hoe',
        base: { title: 'Weed bed A', body: 'Hand hoe' }
      });
      expect(staleEdit.status).toBe(409);
      const editBody = await staleEdit.json();
      expect(editBody.fields.map((f: { field: string }) => f.field)).toEqual(['title']);
      expect(editBody.current).toEqual({
        title: 'Weed both beds',
        body: 'Hand hoe',
        scheduledFor: APR_1 + 3 * DAY,
        assigneeUserId: null
      });
      expect(getTask(farm.taskId)?.body).toBe('Hand hoe');

      await patchTask(farm.taskId, { action: 'reschedule', scheduledFor: APR_1 + 4 * DAY });
      const staleMove = await patchTask(farm.taskId, {
        action: 'reschedule',
        scheduledFor: APR_1 + 5 * DAY,
        base: { scheduledFor: APR_1 + 3 * DAY }
      });
      expect(staleMove.status).toBe(409);
      expect(getTask(farm.taskId)?.scheduledFor).toBe(APR_1 + 4 * DAY);

      const assigned = await patchTask(farm.taskId, {
        action: 'assign',
        assigneeUserId: farm.helperId,
        base: { assigneeUserId: null }
      });
      expect(assigned.status).toBe(200);
      const staleAssign = await patchTask(farm.taskId, {
        action: 'assign',
        assigneeUserId: farm.otherHelperId,
        base: { assigneeUserId: null }
      });
      expect(staleAssign.status).toBe(409);
      expect(getTask(farm.taskId)?.assigneeUserId).toBe(farm.helperId);
    });
  });

  it('checks a foreign assignee before the conflict', async () => {
    const farm = seedEditFarm();
    const other = seedEditFarm('edits-other');
    await runWithTenant(farm.ownerId, async () => {
      const res = await patchTask(farm.taskId, {
        action: 'assign',
        assigneeUserId: other.helperId,
        base: { assigneeUserId: 'someone-else' }
      });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('FOREIGN_REF');
    });
  });

  it('never refuses closing a task', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      await patchTask(farm.taskId, { action: 'edit', title: 'Changed' });
      const done = await patchTask(farm.taskId, {
        action: 'complete',
        base: { title: 'Weed bed A' }
      });
      expect(done.status).toBe(200);
      expect(getTask(farm.taskId)?.completedAt).toBeDefined();
    });
    const farm2 = seedEditFarm();
    await runWithTenant(farm2.ownerId, async () => {
      await patchTask(farm2.taskId, { action: 'edit', title: 'Changed' });
      const skip = await patchTask(farm2.taskId, { action: 'abort', base: { title: 'x' } });
      expect(skip.status).toBe(200);
      expect(getTask(farm2.taskId)?.abortedAt).toBeDefined();
    });
  });

  it('answers 404 for a missing task before any conflict', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      const res = await patchTask('nope', { action: 'edit', title: 'x', base: { title: 'y' } });
      expect(res.status).toBe(404);
    });
  });
});

describe('replay through withClientRecordId', () => {
  it('releases the claim on 409 so the rebased resend saves, then answers duplicate', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      const clientRecordId = `ce_${randomUUID().replace(/-/g, '')}`;
      await patchCrop(farm.cropId, { action: 'edit-details', varietyDisplayName: 'Romaine' });
      const first = await patchCrop(
        farm.cropId,
        {
          action: 'edit-details',
          varietyDisplayName: 'Cos',
          base: { varietyDisplayName: 'Lettuce' }
        },
        { clientRecordId }
      );
      expect(first.status).toBe(409);
      expect(getCrop(farm.cropId)?.varietyDisplayName).toBe('Romaine');

      const resend = await patchCrop(
        farm.cropId,
        {
          action: 'edit-details',
          varietyDisplayName: 'Cos',
          base: { varietyDisplayName: 'Romaine' }
        },
        { clientRecordId }
      );
      expect(resend.status).toBe(200);
      expect(getCrop(farm.cropId)?.varietyDisplayName).toBe('Cos');

      const again = await patchCrop(
        farm.cropId,
        {
          action: 'edit-details',
          varietyDisplayName: 'Cos',
          base: { varietyDisplayName: 'Romaine' }
        },
        { clientRecordId }
      );
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ ok: true, duplicate: true });
    });
  });

  it('works the same for a queued task edit', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      const clientRecordId = `ce_${randomUUID().replace(/-/g, '')}`;
      const body = {
        action: 'reschedule',
        scheduledFor: APR_1 + 9 * DAY,
        base: { scheduledFor: APR_1 + 3 * DAY }
      };
      const first = await patchTask(farm.taskId, body, { clientRecordId });
      expect(first.status).toBe(200);
      const dup = await patchTask(farm.taskId, body, { clientRecordId });
      expect(await dup.json()).toEqual({ ok: true, duplicate: true });
      expect(getTask(farm.taskId)?.scheduledFor).toBe(APR_1 + 9 * DAY);
    });
  });
});
