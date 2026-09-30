// @vitest-environment node
/**
 * Phase 32F (F1-7, F1-11): a care task written for a plan's next due day
 * keeps the person the plan's last task was given to while they still work
 * on the farm, and the offline snapshot carries assignees and planting
 * time by name only.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { upsertCareTask } from '$lib/db/careTasks';
import { assignTask, completeTask, createTask, getTask, reanchorCropTasks } from '$lib/db/tasks';
import { materializeSeedStartTasks } from './seedStartTasks';
import { seedStartTaskId } from '$lib/schedule/seedStart';
import { insertTimeEntry } from '$lib/db/taskTime';
import { revokeAssignment } from '$lib/db/users';
import { careTaskId } from '$lib/animals/carePlans';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { buildFarmSnapshot } from './cardSnapshot';

function farm() {
  const tag = randomUUID().slice(0, 8);
  const ownerId = `carry-${tag}`;
  const owner = `carry-own-${tag}`;
  const helper = `carry-help-${tag}`;
  const inspector = `carry-insp-${tag}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  db.insert(users)
    .values({ id: owner, email: `${owner}@x.test`, displayName: 'Rene' })
    .run();
  db.insert(users)
    .values({ id: helper, email: `${helper}@x.test` })
    .run();
  db.insert(users)
    .values({ id: inspector, email: `${inspector}@x.test` })
    .run();
  for (const [userId, role] of [
    [owner, 'owner'],
    [helper, 'helper'],
    [inspector, 'inspector']
  ] as const) {
    db.insert(helperAssignments)
      .values({ ownerId, userId, roleWithinOwner: role, status: 'active' })
      .run();
  }
  return { ownerId, owner, helper, inspector };
}

const write = (planId: string, dueOn: string) =>
  upsertCareTask({
    title: 'Deworm: Herd A',
    meta: {
      subjectType: 'group',
      subjectId: 'g1',
      planId,
      dueOn,
      careKind: 'deworm',
      leadDays: 3
    }
  });

describe('care tasks keep their person (F1-7)', () => {
  it('the next due day inherits the assignee; a revoked helper is not carried', () => {
    const f = farm();
    const planId = randomUUID();
    runWithTenant(f.ownerId, () => {
      write(planId, '2026-06-01');
      const first = careTaskId(planId, '2026-06-01');
      assignTask(first, f.helper);
      completeTask(first);
      write(planId, '2026-07-01');
      expect(getTask(careTaskId(planId, '2026-07-01'))!.assigneeUserId).toBe(f.helper);
      write(planId, '2026-07-01');
      expect(getTask(careTaskId(planId, '2026-07-01'))!.assigneeUserId).toBe(f.helper);
    });
    revokeAssignment(f.ownerId, f.helper);
    runWithTenant(f.ownerId, () => {
      expect(getTask(careTaskId(planId, '2026-07-01'))!.assigneeUserId).toBeNull();
      write(planId, '2026-08-01');
      expect(getTask(careTaskId(planId, '2026-08-01'))!.assigneeUserId).toBeNull();
    });
  });

  it('an explicit unassign carries forward as unassigned', () => {
    const f = farm();
    const planId = randomUUID();
    runWithTenant(f.ownerId, () => {
      write(planId, '2026-06-01');
      const first = careTaskId(planId, '2026-06-01');
      assignTask(first, f.helper);
      completeTask(first);
      write(planId, '2026-07-01');
      const second = careTaskId(planId, '2026-07-01');
      expect(getTask(second)!.assigneeUserId).toBe(f.helper);
      assignTask(second, null);
      write(planId, '2026-08-01');
      expect(getTask(careTaskId(planId, '2026-08-01'))!.assigneeUserId).toBeNull();
    });
  });

  it('another plan’s assignee never leaks in', () => {
    const f = farm();
    const a = randomUUID();
    const b = randomUUID();
    runWithTenant(f.ownerId, () => {
      write(a, '2026-06-01');
      assignTask(careTaskId(a, '2026-06-01'), f.helper);
      write(b, '2026-06-01');
      expect(getTask(careTaskId(b, '2026-06-01'))!.assigneeUserId).toBeNull();
    });
  });
});

describe('rewritten tasks keep their person (F1-7)', () => {
  it('a plugin re-anchor and a seed-start re-date keep the assignee', () => {
    const f = farm();
    runWithTenant(f.ownerId, () => {
      const area = createField({ name: 'Garden', kind: 'garden' });
      const block = createBlock({ name: 'Bed 2', fieldId: area.id, acres: 0.01 });
      const crop = createPlanned({
        blockId: block.id,
        cropPluginId: 'tomato',
        varietyDisplayName: 'Brandywine'
      });
      const t = createTask({
        title: 'Side-dress',
        kind: 'primary',
        scheduledFor: Date.parse('2026-06-10T12:00:00Z'),
        cropId: crop.id
      });
      assignTask(t.id, f.helper);
      reanchorCropTasks(crop.id, Date.parse('2026-06-01'), Date.parse('2026-06-08'));
      const moved = getTask(t.id)!;
      expect(moved.scheduledFor).toBe(Date.parse('2026-06-17T12:00:00Z'));
      expect(moved.assigneeUserId).toBe(f.helper);

      const plugin = {
        plantingGuide: {
          startIndoorsWeeks: { min: 6, max: 8 },
          hardenOffDays: { min: 7, max: 10 },
          establishment: 'transplant' as const
        }
      };
      const input = {
        cropId: crop.id,
        blockId: block.id,
        cropName: 'Brandywine',
        bedName: 'Bed 2',
        inGroundMs: Date.parse('2026-06-01T12:00:00Z'),
        plugin,
        nowMs: Date.parse('2026-03-01T12:00:00Z')
      };
      materializeSeedStartTasks(input);
      const sowId = seedStartTaskId(crop.id, 'sow');
      assignTask(sowId, f.helper);
      materializeSeedStartTasks({ ...input, inGroundMs: Date.parse('2026-06-08T12:00:00Z') });
      expect(getTask(sowId)!.assigneeUserId).toBe(f.helper);
    });
  });
});

describe('snapshot assignees (F1-11, F1-17)', () => {
  it('carries names of working members, task assignees and planting totals only', async () => {
    const f = farm();
    const other = farm();
    const { taskId, cropId } = runWithTenant(f.ownerId, () => {
      const area = createField({ name: 'Garden', kind: 'garden' });
      const block = createBlock({ name: 'Bed 1', fieldId: area.id, acres: 0.01 });
      const crop = createPlanned({
        blockId: block.id,
        cropPluginId: 'tomato',
        varietyDisplayName: 'Cherokee Purple'
      });
      const t = createTask({
        title: 'Stake',
        kind: 'primary',
        scheduledFor: Date.now(),
        cropId: crop.id
      });
      assignTask(t.id, f.helper);
      insertTimeEntry({
        taskId: t.id,
        userId: f.helper,
        cropId: crop.id,
        startedAt: Date.now() - 3_600_000,
        minutes: 45
      });
      return { taskId: t.id, cropId: crop.id };
    });
    const snap = await runWithTenantAsync(f.ownerId, () => buildFarmSnapshot());
    expect(snap.people?.map((p) => p.id).sort()).toEqual([f.helper, f.owner].sort());
    expect(snap.people?.find((p) => p.id === f.owner)?.name).toBe('Rene');
    expect(snap.tasks.find((t) => t.id === taskId)?.assigneeUserId).toBe(f.helper);
    expect(snap.plantings.find((p) => p.id === cropId)?.minutesLogged).toBe(45);
    const text = JSON.stringify(snap);
    expect(text).not.toContain('@x.test');
    expect(text).not.toContain(other.helper);
    const theirs = await runWithTenantAsync(other.ownerId, () => buildFarmSnapshot());
    expect(JSON.stringify(theirs)).not.toContain(f.helper);
  });
});
