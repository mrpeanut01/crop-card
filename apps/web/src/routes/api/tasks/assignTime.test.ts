// @vitest-environment node
/**
 * Phase 32F F1 on a real DB: owners give tasks to farm members, helpers
 * cannot, another Owner's users and inspectors are refused, closed tasks
 * stay as they were, linked prep and follow-up tasks go along, a revoked
 * helper's open tasks go back to nobody, and time on Done is saved once
 * for the person closing, with its planting, block and field.
 */
import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { abortTask, createTask, getTask, listTasks } from '$lib/db/tasks';
import { listTimeEntries, listTimeEntriesForTask, minutesByCrop } from '$lib/db/taskTime';
import { revokeAssignment } from '$lib/db/users';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { createCloseout } from '$lib/db/seasonCloseouts';
import { seasonYearOf } from '$lib/server/seasonClose';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { POST as CREATE } from './+server';
import { PATCH } from './[id]/+server';
import { POST as CLOSE } from './close/+server';
import { GET as ASSIGNEES } from './assignees/+server';
import { GET as HOURS } from '../plantings/[id]/hours/+server';

const phones = new Map<string, string>();

type Role = 'owner' | 'helper' | 'inspector' | 'custom-operator';

interface Farm {
  ownerId: string;
  owner: string;
  helper: string;
  operator: string;
  inspector: string;
}

function user(id: string, extra: Partial<typeof users.$inferInsert> = {}) {
  db.insert(users)
    .values({ id, email: `${id}@example.test`, ...extra })
    .onConflictDoNothing()
    .run();
}

function member(ownerId: string, userId: string, role: Role) {
  db.insert(helperAssignments)
    .values({ ownerId, userId, roleWithinOwner: role, status: 'active' })
    .onConflictDoNothing()
    .run();
}

function farm(): Farm {
  const tag = randomUUID().slice(0, 8);
  const ownerId = `f1-${tag}`;
  db.insert(owners)
    .values({ id: ownerId, name: `Farm ${tag}`, slug: ownerId, billingStatus: 'active' })
    .run();
  const f: Farm = {
    ownerId,
    owner: `own-${tag}`,
    helper: `help-${tag}`,
    operator: `op-${tag}`,
    inspector: `insp-${tag}`
  };
  user(f.owner, { displayName: 'Rene' });
  user(f.helper, { displayName: 'Maria' });
  user(f.operator, {
    email: null,
    phone: `+1540${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`
  });
  phones.set(
    f.operator,
    db.select({ p: users.phone }).from(users).where(eq(users.id, f.operator)).get()!.p!
  );
  user(f.inspector);
  member(ownerId, f.owner, 'owner');
  member(ownerId, f.helper, 'helper');
  member(ownerId, f.operator, 'custom-operator');
  member(ownerId, f.inspector, 'inspector');
  return f;
}

function event(
  f: Farm,
  userId: string,
  role: Role,
  init: { method: string; path: string; body?: unknown; headers?: Record<string, string> },
  params: Record<string, string> = {},
  impersonating = false
): RequestEvent {
  const url = new URL(`http://localhost${init.path}`);
  return {
    locals: {
      user: {
        id: userId,
        email: null,
        phone: null,
        role,
        activeOwnerId: f.ownerId,
        isSuperadmin: impersonating,
        impersonating
      }
    },
    params,
    url,
    request: new Request(url.href, {
      method: init.method,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    }),
    cookies: { get: () => undefined }
  } as unknown as RequestEvent;
}

async function call(
  f: Farm,
  handler: (e: RequestEvent) => Response | Promise<Response>,
  e: RequestEvent
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; body: Record<string, any> }> {
  const res = await runWithTenantAsync(f.ownerId, async () => handler(e));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

const assign = (
  f: Farm,
  taskId: string,
  assigneeUserId: string | null,
  as: { userId: string; role: Role; impersonating?: boolean }
) =>
  call(
    f,
    PATCH as never,
    event(
      f,
      as.userId,
      as.role,
      { method: 'PATCH', path: `/api/tasks/${taskId}`, body: { action: 'assign', assigneeUserId } },
      { id: taskId },
      as.impersonating
    )
  );

const close = (
  f: Farm,
  body: Record<string, unknown>,
  as: { userId: string; role: Role },
  clientId?: string
) =>
  call(
    f,
    CLOSE as never,
    event(f, as.userId, as.role, {
      method: 'POST',
      path: '/api/tasks/close',
      body,
      headers: clientId ? { [CLIENT_RECORD_HEADER]: clientId } : {}
    })
  );

function task(
  f: Farm,
  title = 'Stake tomatoes',
  extra: Partial<Parameters<typeof createTask>[0]> = {}
) {
  return runWithTenant(f.ownerId, () =>
    createTask({ title, kind: 'primary', scheduledFor: Date.now(), ...extra })
  );
}

function planting(f: Farm) {
  return runWithTenant(f.ownerId, () => {
    const area = createField({ name: `Garden ${randomUUID().slice(0, 4)}` });
    const block = createBlock({ name: 'Bed 1', fieldId: area.id });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: 'tomato',
      varietyDisplayName: 'Cherokee Purple'
    });
    return { areaId: area.id, blockId: block.id, cropId: crop.id };
  });
}

describe('assigning tasks (F1-1 to F1-4)', () => {
  it('an owner gives a task to a helper, and listTasks names them', async () => {
    const f = farm();
    const t = task(f);
    const res = await assign(f, t.id, f.helper, { userId: f.owner, role: 'owner' });
    expect(res.status).toBe(200);
    expect(res.body.task.assigneeUserId).toBe(f.helper);
    const [row] = runWithTenant(f.ownerId, () => listTasks({})).filter((x) => x.id === t.id);
    expect(row.assignee).toEqual({ id: f.helper, name: 'Maria' });
    expect(row.assignedAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it('names a phone-only member by the last four digits, never the number', async () => {
    const f = farm();
    const t = task(f);
    await assign(f, t.id, f.operator, { userId: f.owner, role: 'owner' });
    const [row] = runWithTenant(f.ownerId, () => listTasks({})).filter((x) => x.id === t.id);
    expect(row.assignee?.name).toBe(`phone ending ${phones.get(f.operator)!.slice(-4)}`);
  });

  it('unassigning clears the person and the time it was given', async () => {
    const f = farm();
    const t = task(f);
    await assign(f, t.id, f.helper, { userId: f.owner, role: 'owner' });
    const res = await assign(f, t.id, null, { userId: f.owner, role: 'owner' });
    expect(res.status).toBe(200);
    const after = runWithTenant(f.ownerId, () => getTask(t.id))!;
    expect(after.assigneeUserId).toBeNull();
    expect(after.assignedAt).toBeUndefined();
  });

  it('helpers, custom operators, inspectors and impersonation get "Ask the owner."', async () => {
    const f = farm();
    const t = task(f);
    for (const as of [
      { userId: f.helper, role: 'helper' as const },
      { userId: f.operator, role: 'custom-operator' as const },
      { userId: f.inspector, role: 'inspector' as const },
      { userId: 'super', role: 'owner' as const, impersonating: true }
    ]) {
      const res = await assign(f, t.id, f.helper, as);
      expect(res.status, as.role).toBe(403);
      expect(res.body).toMatchObject({ error: 'Ask the owner.', askOwner: true });
    }
    expect(runWithTenant(f.ownerId, () => getTask(t.id))!.assigneeUserId).toBeNull();
  });

  it('refuses an inspector, a stranger or another Owner’s helper as the assignee', async () => {
    const f = farm();
    const other = farm();
    const t = task(f);
    user('stranger-f1');
    for (const who of [f.inspector, other.helper, 'stranger-f1', 'no-such-user']) {
      const res = await assign(f, t.id, who, { userId: f.owner, role: 'owner' });
      expect(res.status, who).toBe(400);
      expect(res.body.code).toBe('FOREIGN_REF');
    }
  });

  it('never reaches another Owner’s task', async () => {
    const f = farm();
    const other = farm();
    const theirs = task(other);
    const res = await assign(f, theirs.id, f.helper, { userId: f.owner, role: 'owner' });
    expect(res.status).toBe(404);
    expect(runWithTenant(other.ownerId, () => getTask(theirs.id))!.assigneeUserId).toBeNull();
  });

  it('closed tasks answer 409 TASK_CLOSED', async () => {
    const f = farm();
    const t = task(f);
    runWithTenant(f.ownerId, () => abortTask(t.id, 'rain'));
    const res = await assign(f, t.id, f.helper, { userId: f.owner, role: 'owner' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TASK_CLOSED');
  });

  it('a primary takes its open prep and follow-up tasks along; a closed one stays', async () => {
    const f = farm();
    const primary = task(f, 'Spray kale');
    const pre = task(f, 'Check nozzles', { kind: 'pre-task', linkedToTaskId: primary.id });
    const post = task(f, 'Rinse', { kind: 'post-task', linkedToTaskId: primary.id });
    const donePre = task(f, 'Fill tank', { kind: 'pre-task', linkedToTaskId: primary.id });
    runWithTenant(f.ownerId, () => abortTask(donePre.id, 'not needed', false));
    await assign(f, primary.id, f.helper, { userId: f.owner, role: 'owner' });
    const get = (id: string) => runWithTenant(f.ownerId, () => getTask(id))!;
    expect(get(pre.id).assigneeUserId).toBe(f.helper);
    expect(get(post.id).assigneeUserId).toBe(f.helper);
    expect(get(donePre.id).assigneeUserId).toBeNull();
    const alone = await assign(f, pre.id, f.operator, { userId: f.owner, role: 'owner' });
    expect(alone.status).toBe(200);
    expect(get(primary.id).assigneeUserId).toBe(f.helper);
  });

  it('POST /api/tasks takes an assignee from owners only', async () => {
    const f = farm();
    const body = { title: 'Mulch beds', kind: 'primary', scheduledFor: Date.now() };
    const byOwner = await call(
      f,
      CREATE as never,
      event(f, f.owner, 'owner', {
        method: 'POST',
        path: '/api/tasks',
        body: { ...body, assigneeUserId: f.helper }
      })
    );
    expect(byOwner.status).toBe(201);
    expect(byOwner.body.task.assigneeUserId).toBe(f.helper);

    const byHelper = await call(
      f,
      CREATE as never,
      event(f, f.helper, 'helper', {
        method: 'POST',
        path: '/api/tasks',
        body: { ...body, assigneeUserId: f.helper }
      })
    );
    expect(byHelper.status).toBe(403);
    expect(byHelper.body.askOwner).toBe(true);

    const helperNull = await call(
      f,
      CREATE as never,
      event(f, f.helper, 'helper', {
        method: 'POST',
        path: '/api/tasks',
        body: { ...body, assigneeUserId: null }
      })
    );
    expect(helperNull.status).toBe(201);

    const foreign = await call(
      f,
      CREATE as never,
      event(f, f.owner, 'owner', {
        method: 'POST',
        path: '/api/tasks',
        body: { ...body, assigneeUserId: f.inspector }
      })
    );
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe('FOREIGN_REF');
  });

  it('GET /api/tasks/assignees lists working members for owners only', async () => {
    const f = farm();
    const res = await call(
      f,
      ASSIGNEES as never,
      event(f, f.owner, 'owner', { method: 'GET', path: '/api/tasks/assignees' })
    );
    expect(res.status).toBe(200);
    const ids = res.body.assignees.map((a: { id: string }) => a.id).sort();
    expect(ids).toEqual([f.helper, f.operator, f.owner].sort());
    for (const a of res.body.assignees) expect(a.name).not.toContain('@');
    const helper = await call(
      f,
      ASSIGNEES as never,
      event(f, f.helper, 'helper', { method: 'GET', path: '/api/tasks/assignees' })
    );
    expect(helper.status).toBe(403);
  });

  it('revoking a helper sends their open tasks back to nobody; closed ones keep the name', async () => {
    const f = farm();
    const open = task(f, 'Weed');
    const done = task(f, 'Water');
    await assign(f, open.id, f.helper, { userId: f.owner, role: 'owner' });
    await assign(f, done.id, f.helper, { userId: f.owner, role: 'owner' });
    runWithTenant(f.ownerId, () => abortTask(done.id, 'rain'));
    const other = farm();
    member(other.ownerId, f.helper, 'helper');
    const theirs = task(other, 'Their job');
    await assign(other, theirs.id, f.helper, { userId: other.owner, role: 'owner' });

    expect(revokeAssignment(f.ownerId, f.helper)).toBe(true);
    expect(runWithTenant(f.ownerId, () => getTask(open.id))!.assigneeUserId).toBeNull();
    expect(runWithTenant(f.ownerId, () => getTask(done.id))!.assigneeUserId).toBe(f.helper);
    expect(runWithTenant(other.ownerId, () => getTask(theirs.id))!.assigneeUserId).toBe(f.helper);
  });
});

describe('time on Done (F1-12 to F1-15)', () => {
  it('saves the closer’s minutes with the planting, block and field', async () => {
    const f = farm();
    const place = planting(f);
    const t = task(f, 'Sucker tomatoes', { cropId: place.cropId, blockId: place.blockId });
    await assign(f, t.id, f.helper, { userId: f.owner, role: 'owner' });
    const tapped = Date.now() - 60_000;
    const res = await close(
      f,
      { taskId: t.id, action: 'complete', occurredAt: tapped, minutes: 30 },
      { userId: f.operator, role: 'custom-operator' },
      'client-time-0001'
    );
    expect(res.status).toBe(200);
    expect(res.body.timeSaved).toBe(true);
    const rows = runWithTenant(f.ownerId, () => listTimeEntriesForTask(t.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: f.operator,
      cropId: place.cropId,
      blockId: place.blockId,
      fieldId: place.areaId,
      minutes: 30,
      startedAt: tapped - 30 * 60_000,
      source: 'task-close',
      clientRecordId: 'client-time-0001'
    });
  });

  it('a replay of the same request writes nothing more', async () => {
    const f = farm();
    const t = task(f);
    const body = { taskId: t.id, action: 'complete', minutes: 45 };
    const as = { userId: f.helper, role: 'helper' as const };
    expect((await close(f, body, as, 'client-replay-01')).status).toBe(200);
    const again = await close(f, body, as, 'client-replay-01');
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(runWithTenant(f.ownerId, () => listTimeEntriesForTask(t.id))).toHaveLength(1);
  });

  it('time sent for a job someone else closed is still saved', async () => {
    const f = farm();
    const t = task(f);
    await close(
      f,
      { taskId: t.id, action: 'complete' },
      { userId: f.owner, role: 'owner' },
      'a-first-close'
    );
    const late = await close(
      f,
      { taskId: t.id, action: 'complete', minutes: 15 },
      { userId: f.helper, role: 'helper' },
      'a-second-close'
    );
    expect(late.status).toBe(200);
    expect(late.body).toMatchObject({ alreadyClosed: true, timeSaved: true });
    const rows = runWithTenant(f.ownerId, () => listTimeEntriesForTask(t.id));
    expect(rows.map((r) => [r.userId, r.minutes])).toEqual([[f.helper, 15]]);
  });

  it('Done without time and Skip with time', async () => {
    const f = farm();
    const t = task(f);
    const skip = await close(
      f,
      { taskId: t.id, action: 'abort', minutes: 30 },
      { userId: f.helper, role: 'helper' }
    );
    expect(skip.status).toBe(400);
    const done = await close(
      f,
      { taskId: t.id, action: 'complete' },
      { userId: f.helper, role: 'helper' }
    );
    expect(done.status).toBe(200);
    expect(done.body.timeSaved).toBeUndefined();
    expect(runWithTenant(f.ownerId, () => listTimeEntriesForTask(t.id))).toHaveLength(0);
    for (const minutes of [0, 721, 1.5, -5]) {
      const bad = await close(
        f,
        { taskId: task(f).id, action: 'complete', minutes },
        { userId: f.helper, role: 'helper' }
      );
      expect(bad.status, String(minutes)).toBe(400);
    }
  });

  it('PATCH complete takes minutes too, and abort refuses them', async () => {
    const f = farm();
    const t = task(f);
    const res = await call(
      f,
      PATCH as never,
      event(
        f,
        f.helper,
        'helper',
        { method: 'PATCH', path: `/api/tasks/${t.id}`, body: { action: 'complete', minutes: 120 } },
        { id: t.id }
      )
    );
    expect(res.status).toBe(200);
    expect(res.body.timeSaved).toBe(true);
    const aborted = await call(
      f,
      PATCH as never,
      event(
        f,
        f.helper,
        'helper',
        { method: 'PATCH', path: `/api/tasks/${t.id}`, body: { action: 'abort', minutes: 5 } },
        { id: t.id }
      )
    );
    expect(aborted.status).toBe(400);
    expect(runWithTenant(f.ownerId, () => listTimeEntriesForTask(t.id))[0].minutes).toBe(120);
  });

  it('a closed season never stops closing with time or assigning (F0-5)', async () => {
    const f = farm();
    runWithTenant(f.ownerId, () =>
      createCloseout({ year: seasonYearOf(Date.now()), snapshotJson: '{}' })
    );
    const t = task(f);
    const a = await assign(f, t.id, f.helper, { userId: f.owner, role: 'owner' });
    expect(a.status).toBe(200);
    const done = await close(
      f,
      { taskId: t.id, action: 'complete', minutes: 60 },
      { userId: f.helper, role: 'helper' }
    );
    expect(done.status).toBe(200);
    expect(done.body.timeSaved).toBe(true);
  });

  it('time reads stay inside the Owner', async () => {
    const f = farm();
    const other = farm();
    const place = planting(f);
    const t = task(f, 'Harvest', { cropId: place.cropId });
    await close(
      f,
      { taskId: t.id, action: 'complete', minutes: 90 },
      { userId: f.helper, role: 'helper' }
    );
    const range = { fromMs: 0, toMs: Date.now() + 1000 };
    expect(runWithTenant(f.ownerId, () => listTimeEntries(range)).length).toBeGreaterThan(0);
    expect(runWithTenant(other.ownerId, () => listTimeEntries(range))).toEqual([]);
    expect(runWithTenant(other.ownerId, () => minutesByCrop([place.cropId])).size).toBe(0);
    expect(runWithTenant(f.ownerId, () => minutesByCrop([place.cropId])).get(place.cropId)).toBe(
      90
    );
  });

  it('per-person hours on a planting are for owners only', async () => {
    const f = farm();
    const place = planting(f);
    const t1 = task(f, 'Prune', { cropId: place.cropId });
    const t2 = task(f, 'Tie up', { cropId: place.cropId });
    await close(
      f,
      { taskId: t1.id, action: 'complete', minutes: 60 },
      { userId: f.helper, role: 'helper' }
    );
    await close(
      f,
      { taskId: t2.id, action: 'complete', minutes: 30 },
      { userId: f.owner, role: 'owner' }
    );
    const hours = (userId: string, role: Role) =>
      call(
        f,
        HOURS as never,
        event(
          f,
          userId,
          role,
          { method: 'GET', path: `/api/plantings/${place.cropId}/hours` },
          {
            id: place.cropId
          }
        )
      );
    const owner = await hours(f.owner, 'owner');
    expect(owner.status).toBe(200);
    expect(owner.body.totalMinutes).toBe(90);
    expect(owner.body.byPerson).toEqual([
      { id: f.helper, name: 'Maria', minutes: 60 },
      { id: f.owner, name: 'Rene', minutes: 30 }
    ]);
    expect((await hours(f.helper, 'helper')).status).toBe(403);
    const other = farm();
    const stranger = await call(
      other,
      HOURS as never,
      event(
        other,
        other.owner,
        'owner',
        { method: 'GET', path: `/api/plantings/${place.cropId}/hours` },
        {
          id: place.cropId
        }
      )
    );
    expect(stranger.status).toBe(404);
  });
});
