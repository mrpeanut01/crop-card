// @vitest-environment node
/**
 * Phase 32D care plans end to end on a real DB: materialization, closing a
 * care task through /api/tasks/close (one transaction with the 32C health
 * writer and the hold guard), Skip and snooze, plan edits, the subject
 * leaving, a group split, species defaults and the care-plan API.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'care-user', role: m.role });
  return {
    currentUser: user,
    requireUser: user,
    requireMutator: () => {
      if (m.role === 'inspector') throw error(403, 'inspector role is read-only');
      return user();
    },
    requireOwner: () => {
      if (m.role !== 'owner') throw error(403, 'owner role required');
      return user();
    }
  };
});

vi.mock('$lib/server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/registry')>();
  const species: Record<string, object> = {
    goat: { pluginId: 'goat', displayName: 'Goat', foodProducingDefault: true },
    dog: {
      pluginId: 'dog',
      displayName: 'Dog',
      foodProducingDefault: false,
      careDefaults: [
        { key: 'rabies', kind: 'vaccination', title: 'Rabies vaccine', note: 'Ask your vet.' }
      ]
    }
  };
  return {
    ...actual,
    getDataKinds: async () => ({
      species: { get: (id: string) => species[id] },
      animalHealth: { get: () => undefined, has: () => false }
    })
  };
});

import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { getTask, listTasks } from '$lib/db/tasks';
import { getCarePlan, insertCarePlan, listCarePlansForSubject } from '$lib/db/animalCarePlans';
import { listHealthEvents } from '$lib/db/animalHealth';
import { createStockItem, listMovementsForItem, receiveLot } from '$lib/db/stock';
import { createCloseout } from '$lib/db/seasonCloseouts';
import { seasonYearOf } from '$lib/server/seasonClose';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { addDaysYmd, careTaskId, msToYmd } from '$lib/animals/carePlans';
import { ymdInZone } from '$lib/prefs';
import { farmTimeZone } from '$lib/db/userProfile';
import { materializeCareTasks } from './carePlans';

import { POST as CREATE } from '../../routes/api/animals/+server';
import { DELETE as DELETE_ANIMAL } from '../../routes/api/animals/[id]/+server';
import { POST as CREATE_GROUP } from '../../routes/api/animal-groups/+server';
import { POST as STATUS } from '../../routes/api/animals/status/+server';
import { POST as MOVE } from '../../routes/api/animals/move/+server';
import { POST as CLOSE } from '../../routes/api/tasks/close/+server';
import { PATCH as PATCH_TASK } from '../../routes/api/tasks/[id]/+server';
import {
  GET as LIST_PLANS,
  POST as CREATE_PLAN
} from '../../routes/api/animals/[id]/care-plans/+server';
import {
  DELETE as DELETE_PLAN,
  PATCH as PATCH_PLAN
} from '../../routes/api/animals/[id]/care-plans/[planId]/+server';
import { POST as DEFAULTS } from '../../routes/api/animals/[id]/care-plans/defaults/+server';

function seedOwner(): string {
  const id = `care-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'care-user', email: 'care@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

type Handler = (event: never) => Response | Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function call(
  handler: unknown,
  path: string,
  method: string,
  opts: { params?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: Json }> {
  const url = new URL(`http://localhost/api${path}`);
  try {
    const res = await (handler as Handler)({
      params: opts.params ?? {},
      url,
      request: new Request(url.href, {
        method,
        headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      }),
      locals: {}
    } as never);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (!status) throw e;
    return { status, body: {} };
  }
}

const close = (body: unknown, headers?: Record<string, string>) =>
  call(CLOSE, '/tasks/close', 'POST', { body, headers });

const today = () => ymdInZone(Date.now(), farmTimeZone());

async function dog(name = 'Rex'): Promise<string> {
  const res = await call(CREATE, '/animals', 'POST', {
    body: { speciesId: 'dog', name, purpose: 'pet' }
  });
  expect(res.status).toBe(201);
  return res.body.animal.id;
}

async function goats(): Promise<{ groupId: string; memberIds: string[] }> {
  const barn = createField({ name: `Barn ${randomUUID().slice(0, 4)}`, kind: 'barn' });
  const res = await call(CREATE_GROUP, '/animal-groups', 'POST', {
    body: {
      name: 'Herd A',
      speciesId: 'goat',
      headCount: 6,
      housingFieldId: barn.id,
      members: [{ name: 'Billy' }, { name: 'Nanny' }]
    }
  });
  expect(res.status).toBe(201);
  return {
    groupId: res.body.group.id,
    memberIds: res.body.members.map((a: { id: string }) => a.id)
  };
}

function plan(
  subjectType: 'animal' | 'group',
  subjectId: string,
  kind: 'vaccination' | 'deworm' | 'hoof-trim' | 'vet-visit',
  dueInDays: number,
  extra: { intervalDays?: number | null; leadDays?: number } = {}
) {
  return insertCarePlan({
    subjectType,
    subjectId,
    kind,
    title: kind === 'vaccination' ? 'Rabies vaccine' : `Plan ${kind}`,
    intervalDays: extra.intervalDays === undefined ? 365 : extra.intervalDays,
    nextDueOn: addDaysYmd(today(), dueInDays),
    leadDays: extra.leadDays ?? 14,
    provenance: 'manual'
  });
}

const tick = () => materializeCareTasks(Date.now(), farmTimeZone());

beforeEach(() => {
  m.role = 'owner';
});

describe('materialization (D0-1, D0-2)', () => {
  it('is idempotent across two ticks and never writes past the horizon', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const rex = await dog();
      const soon = plan('animal', rex, 'vaccination', 10);
      const far = plan('animal', rex, 'deworm', 60, { leadDays: 3 });
      const undated = insertCarePlan({
        subjectType: 'animal',
        subjectId: rex,
        kind: 'vaccination',
        title: 'Core vaccines',
        nextDueOn: null,
        leadDays: 14,
        provenance: 'plugin'
      });
      const first = tick();
      expect(first.written).toBe(1);
      const second = tick();
      expect(second.written).toBe(0);
      const care = listTasks({}).filter((t) => t.category === 'animal-care');
      expect(care.map((t) => t.id)).toEqual([careTaskId(soon.id, soon.nextDueOn!)]);
      expect(care[0]).toMatchObject({ title: 'Rabies vaccine: Rex', kind: 'primary' });
      expect(care[0].createdById).toBeUndefined();
      expect(care[0].pluginTemplateKey).toBe(`care:${soon.id}:${soon.nextDueOn}`);
      expect(JSON.parse(care[0].recurrenceJson!)).toMatchObject({
        subjectType: 'animal',
        subjectId: rex,
        planId: soon.id,
        dueOn: soon.nextDueOn
      });
      expect(far.id).not.toBe(undated.id);
    });
  });

  it('keeps a care task due after the season is closed out', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      createCloseout({ year: seasonYearOf(Date.now()), snapshotJson: '{}' });
      const rex = await dog();
      const p = plan('animal', rex, 'vet-visit', 0);
      tick();
      const task = getTask(careTaskId(p.id, p.nextDueOn!));
      expect(task?.completedAt).toBeUndefined();
      expect(task?.abortedAt).toBeUndefined();
      const res = await close({ taskId: task!.id, action: 'complete' });
      expect(res.status).toBe(200);
      expect(listHealthEvents('animal', rex).map((e) => e.kind)).toEqual(['vet-visit']);
    });
  });
});

describe('closing a care task (D0-5)', () => {
  it('refuses a quick Done on a vaccine and saves the dose with the task in one write', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const rex = await dog();
      const p = plan('animal', rex, 'vaccination', 3);
      tick();
      const taskId = careTaskId(p.id, p.nextDueOn!);

      const quick = await close({ taskId, action: 'complete' });
      expect(quick.status).toBe(422);
      expect(quick.body.code).toBe('CARE_NEEDS_RECORD');
      const quickPatch = await call(PATCH_TASK, `/tasks/${taskId}`, 'PATCH', {
        params: { id: taskId },
        body: { action: 'complete' }
      });
      expect(quickPatch.status).toBe(422);
      expect(getTask(taskId)?.completedAt).toBeUndefined();

      const at = Date.now() - 60_000;
      const body = {
        taskId,
        action: 'complete',
        occurredAt: at,
        healthEvent: {
          subjectType: 'animal',
          subjectId: rex,
          kind: 'vaccination',
          productName: 'Rabies shot',
          administeredAt: at
        }
      };
      const headers = { [CLIENT_RECORD_HEADER]: `care-${randomUUID()}` };
      const done = await close(body, headers);
      expect(done.status).toBe(200);
      expect(done.body.event.kind).toBe('vaccination');
      expect(done.body.event.rulesVersion).toBeTruthy();
      expect(done.body.nextDueOn).toBe(addDaysYmd(ymdInZone(at, farmTimeZone()), 365));
      const task = getTask(taskId)!;
      expect(task.completedAt).toBe(at);
      expect(task.relatedEventTable).toBe('animal_health_event');
      expect(task.relatedEventId).toBe(done.body.event.id);
      expect(getCarePlan(p.id)?.nextDueOn).toBe(done.body.nextDueOn);

      const replay = await close(body, headers);
      expect(replay.status).toBe(200);
      expect(listHealthEvents('animal', rex)).toHaveLength(1);
      const again = await close({ ...body }, { [CLIENT_RECORD_HEADER]: `care-${randomUUID()}` });
      expect(again.status).toBe(200);
      expect(again.body.alreadyClosed).toBe(true);
      expect(again.body.duplicateOf).toBe(done.body.event.id);
      expect(again.body.warnings.map((w: { code: string }) => w.code)).toEqual([
        'TASK_ALREADY_DONE'
      ]);
      expect(listHealthEvents('animal', rex)).toHaveLength(1);
      const staleDevice = await close(
        {
          ...body,
          healthEvent: {
            ...body.healthEvent,
            productName: '  rabies SHOT ',
            administeredAt: at - 3 * 3600_000
          }
        },
        { [CLIENT_RECORD_HEADER]: `care-${randomUUID()}` }
      );
      expect(staleDevice.body.alreadyClosed).toBe(true);
      expect(listHealthEvents('animal', rex)).toHaveLength(1);
      expect(getCarePlan(p.id)?.nextDueOn).toBe(done.body.nextDueOn);
      const other = await close(
        { ...body, healthEvent: { ...body.healthEvent, productName: 'Other vaccine' } },
        { [CLIENT_RECORD_HEADER]: `care-${randomUUID()}` }
      );
      expect(other.body.alreadyClosed).toBe(true);
      expect(other.body.warnings.map((w: { code: string }) => w.code)).toContain(
        'TASK_ALREADY_CLOSED'
      );
      expect(listHealthEvents('animal', rex)).toHaveLength(2);
      const noDose = await close(
        { taskId, action: 'complete' },
        { [CLIENT_RECORD_HEADER]: `care-${randomUUID()}` }
      );
      expect(noDose.body.alreadyClosed).toBe(true);
      expect(listHealthEvents('animal', rex)).toHaveLength(2);
    });
  });

  it('still saves a queued dose when the task was ended another way before it synced', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await goats();
      const p = plan('group', groupId, 'deworm', 2);
      tick();
      const taskId = careTaskId(p.id, p.nextDueOn!);
      const edit = await call(PATCH_PLAN, `/animals/${groupId}/care-plans/${p.id}`, 'PATCH', {
        params: { id: groupId, planId: p.id },
        body: { active: false }
      });
      expect(edit.status).toBe(200);
      expect(getTask(taskId)?.abortedAt).toBeDefined();

      m.role = 'helper';
      const at = Date.now() - 60 * 60_000;
      const replay = await close(
        {
          taskId,
          action: 'complete',
          occurredAt: at,
          healthEvent: {
            subjectType: 'group',
            subjectId: groupId,
            kind: 'deworm',
            productName: 'Wormer',
            administeredAt: at
          }
        },
        { [CLIENT_RECORD_HEADER]: `care-${randomUUID()}` }
      );
      expect(replay.status).toBe(200);
      expect(replay.body.alreadyClosed).toBe(true);
      expect(replay.body.event.kind).toBe('deworm');
      expect(replay.body.warnings.map((w: { code: string }) => w.code)).toContain(
        'TASK_ALREADY_CLOSED'
      );
      expect(listHealthEvents('group', groupId)).toHaveLength(1);
      expect(getTask(taskId)?.completedAt).toBeUndefined();
    });
  });

  it('does not save a dose or take stock twice when Done is re-sent with a new client id', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await goats();
      const item = createStockItem({
        category: 'adjuvant',
        displayName: 'Goat wormer',
        defaultUnit: 'fl-oz'
      });
      receiveLot({ stockItemId: item.id, receivedQuantity: 16, unit: 'fl-oz' });
      const p = plan('group', groupId, 'deworm', 2);
      tick();
      const taskId = careTaskId(p.id, p.nextDueOn!);
      const at = Date.now() - 60_000;
      const body = {
        taskId,
        action: 'complete',
        occurredAt: at,
        healthEvent: {
          subjectType: 'group',
          subjectId: groupId,
          kind: 'deworm',
          stockItemId: item.id,
          dose: 2,
          doseUnit: 'fl-oz',
          administeredAt: at
        }
      };
      const first = await close(body, { [CLIENT_RECORD_HEADER]: `care-${randomUUID()}` });
      expect(first.status).toBe(200);
      const retry = await close(body, { [CLIENT_RECORD_HEADER]: `care-${randomUUID()}` });
      expect(retry.status).toBe(200);
      expect(retry.body.alreadyClosed).toBe(true);
      expect(retry.body.duplicateOf).toBe(first.body.event.id);
      expect(listHealthEvents('group', groupId)).toHaveLength(1);
      expect(
        listMovementsForItem(item.id).filter((mv) => mv.reason === 'animal-treatment')
      ).toHaveLength(1);
    });
  });

  it("lets the owner set the next due day (manual) but not a helper, and stores a helper's label use as unknown", async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const rex = await dog();
      const a = plan('animal', rex, 'vaccination', 1);
      const b = plan('animal', rex, 'deworm', 1);
      tick();
      const threeYears = addDaysYmd(today(), 3 * 365);
      const shot = {
        subjectType: 'animal',
        subjectId: rex,
        kind: 'vaccination',
        productName: 'Rabies shot',
        administeredAt: Date.now() - 1000
      };
      const owner = await close({
        taskId: careTaskId(a.id, a.nextDueOn!),
        action: 'complete',
        nextDueOn: threeYears,
        healthEvent: shot
      });
      expect(owner.status).toBe(200);
      expect(getCarePlan(a.id)).toMatchObject({ nextDueOn: threeYears, provenance: 'manual' });

      m.role = 'helper';
      const helper = await close({
        taskId: careTaskId(b.id, b.nextDueOn!),
        action: 'complete',
        nextDueOn: threeYears,
        healthEvent: { ...shot, kind: 'deworm', productName: 'Wormer', labelUse: 'label' }
      });
      expect(helper.status).toBe(200);
      expect(helper.body.event.labelUse).toBe('unknown');
      expect(helper.body.warnings.map((w: { code: string }) => w.code)).toEqual(
        expect.arrayContaining(['NEXT_DUE_OWNER', 'LABEL_USE_OWNER'])
      );
      expect(getCarePlan(b.id)?.nextDueOn).toBe(addDaysYmd(today(), 365));
    });
  });

  it('refuses a treatment for a different animal than the task', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const rex = await dog();
      const fido = await dog('Fido');
      const p = plan('animal', rex, 'deworm', 1);
      tick();
      const res = await close({
        taskId: careTaskId(p.id, p.nextDueOn!),
        action: 'complete',
        healthEvent: {
          subjectType: 'animal',
          subjectId: fido,
          kind: 'deworm',
          productName: 'Wormer',
          administeredAt: Date.now() - 1000
        }
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SUBJECT_MISMATCH');
      expect(listHealthEvents('animal', fido)).toEqual([]);
    });
  });

  it('closes husbandry kinds as plain tasks with no health event', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await goats();
      const p = plan('group', groupId, 'hoof-trim', 1, { intervalDays: 60, leadDays: 3 });
      tick();
      const res = await close({ taskId: careTaskId(p.id, p.nextDueOn!), action: 'complete' });
      expect(res.status).toBe(200);
      expect(listHealthEvents('group', groupId)).toEqual([]);
      expect(getCarePlan(p.id)?.nextDueOn).toBe(addDaysYmd(today(), 60));
    });
  });
});

describe('deleting a pet added by mistake', () => {
  it('ignores and removes the untouched plans its species seeded, but not an edited one', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const rex = await dog();
      expect(listCarePlansForSubject('animal', rex)).toHaveLength(1);
      const del = await call(DELETE_ANIMAL, `/animals/${rex}`, 'DELETE', { params: { id: rex } });
      expect(del.status).toBe(200);
      expect(listCarePlansForSubject('animal', rex)).toEqual([]);

      const fido = await dog('Fido');
      const [seeded] = listCarePlansForSubject('animal', fido);
      const edit = await call(PATCH_PLAN, `/animals/${fido}/care-plans/${seeded.id}`, 'PATCH', {
        params: { id: fido, planId: seeded.id },
        body: { nextDueOn: addDaysYmd(today(), 30) }
      });
      expect(edit.status).toBe(200);
      const kept = await call(DELETE_ANIMAL, `/animals/${fido}`, 'DELETE', {
        params: { id: fido }
      });
      expect(kept.status).toBe(409);
      expect(kept.body.code).toBe('ANIMAL_HAS_RECORDS');
    });
  });
});

describe('a repeating plan with no interval (D2-09)', () => {
  it('stays on and waits undated after Done or Skip; only a one-off plan ends', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const rex = await dog();
      const done = plan('animal', rex, 'vaccination', 1, { intervalDays: null });
      const skipped = plan('animal', rex, 'deworm', 1, { intervalDays: null });
      const once = insertCarePlan({
        subjectType: 'animal',
        subjectId: rex,
        kind: 'vet-visit',
        title: 'Spay',
        onceOn: addDaysYmd(today(), 1),
        nextDueOn: addDaysYmd(today(), 1),
        leadDays: 14,
        provenance: 'manual'
      });
      tick();

      m.role = 'helper';
      const shot = await close({
        taskId: careTaskId(done.id, done.nextDueOn!),
        action: 'complete',
        healthEvent: {
          subjectType: 'animal',
          subjectId: rex,
          kind: 'vaccination',
          productName: 'Booster',
          administeredAt: Date.now() - 1000
        }
      });
      expect(shot.status).toBe(200);
      expect(getCarePlan(done.id)).toMatchObject({ active: true, nextDueOn: null });

      const skip = await close({
        taskId: careTaskId(skipped.id, skipped.nextDueOn!),
        action: 'abort',
        careSkip: 'skip-this'
      });
      expect(skip.status).toBe(200);
      expect(getCarePlan(skipped.id)).toMatchObject({ active: true, nextDueOn: null });

      const visit = await close({
        taskId: careTaskId(once.id, once.nextDueOn!),
        action: 'complete'
      });
      expect(visit.status).toBe(200);
      expect(getCarePlan(once.id)?.active).toBe(false);
    });
  });
});

describe('Skip and snooze (D0-3)', () => {
  it('never rolls a hold-bearing task silently', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const rex = await dog();
      const p = plan('animal', rex, 'vaccination', 2);
      tick();
      const taskId = careTaskId(p.id, p.nextDueOn!);
      const silent = await close({ taskId, action: 'abort' });
      expect(silent.status).toBe(422);
      expect(silent.body.code).toBe('CARE_SKIP_CHOICE');
      const patch = await call(PATCH_TASK, `/tasks/${taskId}`, 'PATCH', {
        params: { id: taskId },
        body: { action: 'abort', reason: 'busy' }
      });
      expect(patch.status).toBe(422);

      const snooze = await close({ taskId, action: 'abort', careSkip: 'snooze', snoozeDays: 3 });
      expect(snooze.status).toBe(200);
      expect(snooze.body.snoozedUntil).toBe(addDaysYmd(today(), 3));
      const snoozed = getTask(taskId)!;
      expect(snoozed.abortedAt).toBeUndefined();
      expect(msToYmd(snoozed.scheduledFor)).toBe(addDaysYmd(today(), 3));
      expect(getCarePlan(p.id)?.nextDueOn).toBe(p.nextDueOn);
      tick();
      expect(msToYmd(getTask(taskId)!.scheduledFor)).toBe(addDaysYmd(today(), 3));

      const skip = await close({ taskId, action: 'abort', careSkip: 'skip-this' });
      expect(skip.status).toBe(200);
      expect(skip.body.nextDueOn).toBe(addDaysYmd(p.nextDueOn!, 365));
      expect(getTask(taskId)?.abortedAt).toBeDefined();
    });
  });

  it('a husbandry Skip through the /today PATCH skips this one', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const rex = await dog();
      const p = plan('animal', rex, 'hoof-trim', 0, { intervalDays: 30, leadDays: 3 });
      tick();
      const taskId = careTaskId(p.id, p.nextDueOn!);
      const res = await call(PATCH_TASK, `/tasks/${taskId}`, 'PATCH', {
        params: { id: taskId },
        body: { action: 'abort', reason: 'Too wet' }
      });
      expect(res.status).toBe(200);
      expect(getTask(taskId)?.abortReason).toBe('Too wet');
      expect(getCarePlan(p.id)?.nextDueOn).toBe(addDaysYmd(p.nextDueOn!, 30));
    });
  });
});

describe('plan edits and the subject leaving', () => {
  it('rewrites open tasks on an edit and ends them when the plan is turned off', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const rex = await dog();
      const p = plan('animal', rex, 'vaccination', 5);
      tick();
      const oldId = careTaskId(p.id, p.nextDueOn!);
      const params = { id: rex, planId: p.id };
      const retitle = await call(PATCH_PLAN, `/animals/${rex}/care-plans/${p.id}`, 'PATCH', {
        params,
        body: { title: 'Rabies booster' }
      });
      expect(retitle.status).toBe(200);
      expect(getTask(oldId)).toMatchObject({ title: 'Rabies booster: Rex' });
      expect(getTask(oldId)?.abortedAt).toBeUndefined();

      const newDue = addDaysYmd(today(), 8);
      await call(PATCH_PLAN, `/animals/${rex}/care-plans/${p.id}`, 'PATCH', {
        params,
        body: { nextDueOn: newDue }
      });
      expect(getTask(oldId)?.abortReason).toBe('plan-edited');
      expect(getTask(careTaskId(p.id, newDue))?.abortedAt).toBeUndefined();

      await call(PATCH_PLAN, `/animals/${rex}/care-plans/${p.id}`, 'PATCH', {
        params,
        body: { active: false }
      });
      expect(getTask(careTaskId(p.id, newDue))?.abortReason).toBe('plan-ended');
      tick();
      expect(getTask(careTaskId(p.id, newDue))?.abortReason).toBe('plan-ended');

      await call(PATCH_PLAN, `/animals/${rex}/care-plans/${p.id}`, 'PATCH', {
        params,
        body: { active: true }
      });
      expect(getTask(careTaskId(p.id, newDue))?.abortedAt).toBeUndefined();

      const del = await call(DELETE_PLAN, `/animals/${rex}/care-plans/${p.id}`, 'DELETE', {
        params
      });
      expect(del.status).toBe(200);
      expect(getTask(careTaskId(p.id, newDue))?.abortReason).toBe('plan-ended');
    });
  });

  it('ends open tasks when the animal dies, and a split group keeps its plans', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const rex = await dog();
      const p = plan('animal', rex, 'deworm', 2);
      tick();
      const died = await call(STATUS, '/animals/status', 'POST', {
        body: { subjectType: 'animal', subjectId: rex, status: 'died' }
      });
      expect(died.status).toBe(201);
      expect(getTask(careTaskId(p.id, p.nextDueOn!))?.abortReason).toBe('plan-ended');
      expect(tick().written).toBe(0);

      const { groupId } = await goats();
      plan('group', groupId, 'deworm', 20, { intervalDays: 90, leadDays: 3 });
      const pasture = createField({ name: 'Back pasture', kind: 'pasture' });
      const moved = await call(MOVE, '/animals/move', 'POST', {
        body: {
          subjectType: 'group',
          subjectId: groupId,
          fieldId: pasture.id,
          count: 2,
          newGroupName: 'Herd B'
        }
      });
      expect(moved.status).toBe(201);
      const newGroup = moved.body.move.newGroup.id as string;
      expect(listCarePlansForSubject('group', newGroup).map((x) => x.kind)).toEqual(['deworm']);
    });
  });
});

describe('species defaults and the care-plan API', () => {
  it('adds undated "ask your vet" plans for a new dog and never invents a date', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const rex = await dog();
      const plans = listCarePlansForSubject('animal', rex);
      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({
        kind: 'vaccination',
        title: 'Rabies vaccine',
        nextDueOn: null,
        intervalDays: null,
        provenance: 'plugin',
        leadDays: 14
      });
      expect(tick().written).toBe(0);
      const again = await call(DEFAULTS, `/animals/${rex}/care-plans/defaults`, 'POST', {
        params: { id: rex }
      });
      expect(again.body.added).toEqual([]);

      const refused = await call(PATCH_PLAN, `/animals/${rex}/care-plans/${plans[0].id}`, 'PATCH', {
        params: { id: rex, planId: plans[0].id },
        body: { lastDoneOn: addDaysYmd(today(), -300) }
      });
      expect(refused.status).toBe(400);
      const dated = await call(PATCH_PLAN, `/animals/${rex}/care-plans/${plans[0].id}`, 'PATCH', {
        params: { id: rex, planId: plans[0].id },
        body: { intervalDays: 365, lastDoneOn: addDaysYmd(today(), -355) }
      });
      expect(dated.status).toBe(200);
      expect(dated.body.plan).toMatchObject({
        nextDueOn: addDaysYmd(today(), 10),
        provenance: 'manual'
      });
      expect(getTask(careTaskId(plans[0].id, addDaysYmd(today(), 10)))).toBeDefined();
    });
  });

  it('owners write plans; helpers read them', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await goats();
      m.role = 'helper';
      const denied = await call(CREATE_PLAN, `/animals/${groupId}/care-plans`, 'POST', {
        params: { id: groupId },
        body: { kind: 'deworm', title: 'Worm the herd', intervalDays: 90 }
      });
      expect(denied.status).toBe(403);
      m.role = 'owner';
      const made = await call(CREATE_PLAN, `/animals/${groupId}/care-plans`, 'POST', {
        params: { id: groupId },
        body: {
          kind: 'deworm',
          title: 'Worm the herd',
          intervalDays: 90,
          nextDueOn: addDaysYmd(today(), 4)
        }
      });
      expect(made.status).toBe(201);
      expect(made.body.plan.leadDays).toBe(3);
      m.role = 'helper';
      const list = await call(LIST_PLANS, `/animals/${groupId}/care-plans`, 'GET', {
        params: { id: groupId }
      });
      expect(list.body.plans.map((x: { title: string }) => x.title)).toEqual(['Worm the herd']);
      m.role = 'owner';
      const bad = await call(CREATE_PLAN, `/animals/nope/care-plans`, 'POST', {
        params: { id: 'nope' },
        body: { kind: 'deworm', title: 'x' }
      });
      expect(bad.status).toBe(404);
    });
  });

  it("never lists or edits another Owner's plans through the API", async () => {
    const a = seedOwner();
    const b = seedOwner();
    const theirs = await runWithTenantAsync(b, async () => {
      const rex = await dog();
      return { rex, plan: plan('animal', rex, 'deworm', 2) };
    });
    await runWithTenantAsync(a, async () => {
      const list = await call(LIST_PLANS, `/animals/${theirs.rex}/care-plans`, 'GET', {
        params: { id: theirs.rex }
      });
      expect(list.status).toBe(404);
      const patch = await call(
        PATCH_PLAN,
        `/animals/${theirs.rex}/care-plans/${theirs.plan.id}`,
        'PATCH',
        { params: { id: theirs.rex, planId: theirs.plan.id }, body: { active: false } }
      );
      expect(patch.status).toBe(404);
    });
    expect(runWithTenant(b, () => getCarePlan(theirs.plan.id))?.active).toBe(true);
  });
});
