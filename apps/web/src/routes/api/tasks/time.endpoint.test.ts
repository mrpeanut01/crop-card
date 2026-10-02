// @vitest-environment node
/**
 * Phase 33D (D2) on a real DB: time from the task timer is saved for the
 * person, once per client record id, inside the 30-day window; owners log
 * and remove anyone's time, everyone else only their own within 48 hours;
 * another Owner's tasks and entries are 404; the season close-out is never
 * read.
 */
import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { helperAssignments, owners, taskTimeEntries, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, withTenant } from '$lib/db/tenant';
import { createTask } from '$lib/db/tasks';
import {
  deleteTimeEntry,
  getTimeEntry,
  insertTimeEntry,
  listTimeEntriesForTask
} from '$lib/db/taskTime';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { createCloseout } from '$lib/db/seasonCloseouts';
import { seasonYearOf } from '$lib/server/seasonClose';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { taskTimeEntrySchema } from '$lib/tasks/apiSchemas';
import { timeDeleteVerdict, timeEntryInRange } from '$lib/tasks/timeEntries';
import { GET, POST } from './[id]/time/+server';
import { DELETE } from './time/[id]/+server';

type Role = 'owner' | 'helper' | 'inspector' | 'custom-operator';
const MIN = 60_000;
const DAY = 86_400_000;

interface Farm {
  ownerId: string;
  owner: string;
  helper: string;
  helper2: string;
  inspector: string;
}

function user(id: string, name: string) {
  db.insert(users)
    .values({ id, email: `${id}@example.test`, displayName: name })
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
  const ownerId = `tt-${tag}`;
  db.insert(owners)
    .values({ id: ownerId, name: `Farm ${tag}`, slug: ownerId, billingStatus: 'active' })
    .run();
  const f: Farm = {
    ownerId,
    owner: `own-${tag}`,
    helper: `help-${tag}`,
    helper2: `help2-${tag}`,
    inspector: `insp-${tag}`
  };
  user(f.owner, 'Rene');
  user(f.helper, 'Maria');
  user(f.helper2, 'Sam');
  user(f.inspector, 'Ines');
  member(ownerId, f.owner, 'owner');
  member(ownerId, f.helper, 'helper');
  member(ownerId, f.helper2, 'helper');
  member(ownerId, f.inspector, 'inspector');
  return f;
}

function event(
  f: Farm,
  userId: string,
  role: Role,
  init: { method: string; path: string; body?: unknown; headers?: Record<string, string> },
  params: Record<string, string>
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
        isSuperadmin: false,
        impersonating: false
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

const as = (userId: string, role: Role) => ({ userId, role });

const post = (
  f: Farm,
  taskId: string,
  body: unknown,
  who: { userId: string; role: Role },
  clientId?: string
) =>
  call(
    f,
    POST as never,
    event(
      f,
      who.userId,
      who.role,
      {
        method: 'POST',
        path: `/api/tasks/${taskId}/time`,
        body,
        headers: clientId ? { [CLIENT_RECORD_HEADER]: clientId } : {}
      },
      { id: taskId }
    )
  );

const list = (f: Farm, taskId: string, who: { userId: string; role: Role }) =>
  call(
    f,
    GET as never,
    event(
      f,
      who.userId,
      who.role,
      { method: 'GET', path: `/api/tasks/${taskId}/time` },
      {
        id: taskId
      }
    )
  );

const remove = (f: Farm, entryId: string, who: { userId: string; role: Role }) =>
  call(
    f,
    DELETE as never,
    event(
      f,
      who.userId,
      who.role,
      { method: 'DELETE', path: `/api/tasks/time/${entryId}` },
      {
        id: entryId
      }
    )
  );

function plantedTask(f: Farm) {
  return runWithTenant(f.ownerId, () => {
    const area = createField({ name: `Garden ${randomUUID().slice(0, 4)}` });
    const block = createBlock({ name: 'Bed 1', fieldId: area.id });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: 'tomato',
      varietyDisplayName: 'Cherokee Purple'
    });
    const t = createTask({
      title: 'Stake tomatoes',
      kind: 'primary',
      scheduledFor: Date.now(),
      cropId: crop.id
    });
    return { taskId: t.id, cropId: crop.id, blockId: block.id, fieldId: area.id };
  });
}

function plainTask(f: Farm) {
  return runWithTenant(f.ownerId, () =>
    createTask({ title: 'Fix fence', kind: 'primary', scheduledFor: Date.now() })
  ).id;
}

const span = (minutes: number, endAgoMs = 0) => ({
  startedAt: Date.now() - endAgoMs - minutes * MIN,
  minutes
});

describe('POST /api/tasks/:id/time (D-25)', () => {
  it('saves a helper timer entry with the planting, block and field', async () => {
    const f = farm();
    const p = plantedTask(f);
    const res = await post(f, p.taskId, { ...span(25), note: ' tied up ' }, as(f.helper, 'helper'));
    expect(res.status).toBe(201);
    expect(res.body.entry).toMatchObject({ minutes: 25, source: 'timer', canDelete: true });
    const [row] = runWithTenant(f.ownerId, () => listTimeEntriesForTask(p.taskId));
    expect(row).toMatchObject({
      userId: f.helper,
      cropId: p.cropId,
      blockId: p.blockId,
      fieldId: p.fieldId,
      minutes: 25,
      source: 'timer',
      note: 'tied up'
    });
  });

  it('a replay of the same client record id saves once', async () => {
    const f = farm();
    const t = plainTask(f);
    const body = span(40);
    const first = await post(f, t, body, as(f.helper, 'helper'), 'timer-replay-0001');
    expect(first.status).toBe(201);
    const again = await post(f, t, body, as(f.helper, 'helper'), 'timer-replay-0001');
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    const rows = runWithTenant(f.ownerId, () => listTimeEntriesForTask(t));
    expect(rows).toHaveLength(1);
    expect(rows[0].clientRecordId).toBe('timer-replay-0001');
  });

  it('a queued row replayed under another session keeps the person who worked', async () => {
    const f = farm();
    const t = plainTask(f);
    const body = { ...span(45), userId: f.helper };
    const byOwner = await post(f, t, body, as(f.owner, 'owner'), 'timer-shared-phone-1');
    expect(byOwner.status).toBe(201);
    expect(runWithTenant(f.ownerId, () => listTimeEntriesForTask(t))[0].userId).toBe(f.helper);
    const byHelper2 = await post(f, t, body, as(f.helper2, 'helper'), 'timer-shared-phone-2');
    expect(byHelper2.status).toBe(403);
    expect(runWithTenant(f.ownerId, () => listTimeEntriesForTask(t))).toHaveLength(1);
  });

  it('refuses inspectors', async () => {
    const f = farm();
    const res = await post(f, plainTask(f), span(10), as(f.inspector, 'inspector'));
    expect(res.status).toBe(403);
  });

  it('only the owner logs time for someone else', async () => {
    const f = farm();
    const t = plainTask(f);
    const helper = await post(f, t, { ...span(10), userId: f.helper2 }, as(f.helper, 'helper'));
    expect(helper.status).toBe(403);
    expect(helper.body).toMatchObject({ error: 'OWNER_ONLY', askOwner: true });
    const owner = await post(f, t, { ...span(10), userId: f.helper }, as(f.owner, 'owner'));
    expect(owner.status).toBe(201);
    expect(runWithTenant(f.ownerId, () => listTimeEntriesForTask(t))[0].userId).toBe(f.helper);
    const other = farm();
    const foreign = await post(f, t, { ...span(10), userId: other.helper }, as(f.owner, 'owner'));
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toBe('FOREIGN_REF');
    const inspector = await post(f, t, { ...span(10), userId: f.inspector }, as(f.owner, 'owner'));
    expect(inspector.status).toBe(400);
  });

  it("another Owner's task is 404 and writes nothing", async () => {
    const a = farm();
    const b = farm();
    const theirs = plainTask(b);
    const res = await post(a, theirs, span(10), as(a.owner, 'owner'));
    expect(res.status).toBe(404);
    expect(runWithTenant(b.ownerId, () => listTimeEntriesForTask(theirs))).toHaveLength(0);
  });

  it('keeps time inside the last 30 days and never in the future', async () => {
    const f = farm();
    const t = plainTask(f);
    const old = await post(
      f,
      t,
      { startedAt: Date.now() - 31 * DAY, minutes: 30 },
      as(f.helper, 'helper')
    );
    expect(old.status).toBe(400);
    expect(old.body.error).toBe('TIME_OUT_OF_RANGE');
    const future = await post(f, t, { startedAt: Date.now(), minutes: 30 }, as(f.helper, 'helper'));
    expect(future.body.error).toBe('TIME_OUT_OF_RANGE');
    const slack = await post(
      f,
      t,
      { startedAt: Date.now() - 27 * MIN, minutes: 30 },
      as(f.helper, 'helper')
    );
    expect(slack.status).toBe(201);
    const tooLong = await post(f, t, span(721), as(f.helper, 'helper'));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toBe('INVALID_BODY');
  });

  it('a closed season never stops saving or removing time', async () => {
    const f = farm();
    runWithTenant(f.ownerId, () =>
      createCloseout({ year: seasonYearOf(Date.now()), snapshotJson: '{}' })
    );
    const t = plainTask(f);
    const saved = await post(f, t, span(15), as(f.helper, 'helper'));
    expect(saved.status).toBe(201);
    const gone = await remove(f, saved.body.entry.id, as(f.helper, 'helper'));
    expect(gone.status).toBe(200);
  });
});

describe('GET /api/tasks/:id/time (D-26, D-27)', () => {
  it('owners see every entry with names; helpers the total and their own', async () => {
    const f = farm();
    const t = plainTask(f);
    await post(f, t, span(30), as(f.helper, 'helper'));
    await post(f, t, span(15), as(f.helper2, 'helper'));
    await post(f, t, span(10), as(f.owner, 'owner'));
    const owner = await list(f, t, as(f.owner, 'owner'));
    expect(owner.status).toBe(200);
    expect(owner.body.totalMinutes).toBe(55);
    expect(owner.body.entries.map((e: { name: string }) => e.name).sort()).toEqual([
      'Maria',
      'Rene',
      'Sam'
    ]);
    expect(owner.body.entries.every((e: { canDelete: boolean }) => e.canDelete)).toBe(true);
    const helper = await list(f, t, as(f.helper, 'helper'));
    expect(helper.body.totalMinutes).toBe(55);
    expect(helper.body.entries).toHaveLength(1);
    expect(helper.body.entries[0]).toMatchObject({ userId: f.helper, minutes: 30 });
    expect(helper.body.entries[0].name).toBeUndefined();
  });

  it("another Owner's task is 404", async () => {
    const a = farm();
    const b = farm();
    const theirs = plainTask(b);
    await post(b, theirs, span(10), as(b.owner, 'owner'));
    const res = await list(a, theirs, as(a.owner, 'owner'));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tasks/time/:id (D-26)', () => {
  it('helpers remove their own time for 48 hours, owners anything', async () => {
    const f = farm();
    const t = plainTask(f);
    const mine = (await post(f, t, span(20), as(f.helper, 'helper'))).body.entry.id;
    const theirs = (await post(f, t, span(20), as(f.helper2, 'helper'))).body.entry.id;
    const old = (await post(f, t, span(20), as(f.helper, 'helper'))).body.entry.id;
    runWithTenant(f.ownerId, () =>
      db
        .update(taskTimeEntries)
        .set({ createdAt: new Date(Date.now() - 49 * 60 * MIN) })
        .where(withTenant(taskTimeEntries, eq(taskTimeEntries.id, old)))
        .run()
    );

    const notYours = await remove(f, theirs, as(f.helper, 'helper'));
    expect(notYours.status).toBe(403);
    expect(notYours.body.error).toBe('NOT_YOURS');
    expect(notYours.body.message).toBe(
      'You can remove your own time for 48 hours after saving it. Ask the owner.'
    );
    const late = await remove(f, old, as(f.helper, 'helper'));
    expect(late.body.error).toBe('TOO_LATE');
    expect((await remove(f, mine, as(f.inspector, 'inspector'))).status).toBe(403);

    expect((await remove(f, mine, as(f.helper, 'helper'))).status).toBe(200);
    expect((await remove(f, old, as(f.owner, 'owner'))).status).toBe(200);
    expect((await remove(f, theirs, as(f.owner, 'owner'))).status).toBe(200);
    expect(runWithTenant(f.ownerId, () => listTimeEntriesForTask(t))).toHaveLength(0);
    expect((await remove(f, mine, as(f.owner, 'owner'))).status).toBe(404);
  });

  it("another Owner's entry is 404 and stays", async () => {
    const a = farm();
    const b = farm();
    const theirs = plainTask(b);
    const id = (await post(b, theirs, span(10), as(b.owner, 'owner'))).body.entry.id;
    expect((await remove(a, id, as(a.owner, 'owner'))).status).toBe(404);
    expect(runWithTenant(b.ownerId, () => getTimeEntry(id))).not.toBeNull();
  });
});

describe('tenant-scoped repo (Invariant 6)', () => {
  it('getTimeEntry and deleteTimeEntry never reach another Owner', () => {
    const a = farm();
    const b = farm();
    const t = plainTask(b);
    const row = runWithTenant(b.ownerId, () =>
      insertTimeEntry({
        taskId: t,
        userId: b.owner,
        startedAt: Date.now() - 10 * MIN,
        minutes: 10,
        source: 'timer'
      })
    );
    expect(runWithTenant(a.ownerId, () => getTimeEntry(row.id))).toBeNull();
    expect(runWithTenant(a.ownerId, () => deleteTimeEntry(row.id))).toBe(false);
    expect(runWithTenant(b.ownerId, () => getTimeEntry(row.id))?.source).toBe('timer');
    expect(runWithTenant(b.ownerId, () => deleteTimeEntry(row.id))).toBe(true);
  });
});

describe('pure rules', () => {
  it('timeEntryInRange: 30 days back, 5 minutes of slack ahead', () => {
    const now = 100 * DAY;
    expect(timeEntryInRange(now - 30 * DAY, 10, now)).toBe(true);
    expect(timeEntryInRange(now - 30 * DAY - 1, 10, now)).toBe(false);
    expect(timeEntryInRange(now - 10 * MIN, 15, now)).toBe(true);
    expect(timeEntryInRange(now - 10 * MIN, 16, now)).toBe(false);
  });

  it('timeDeleteVerdict', () => {
    const now = 10 * DAY;
    const fresh = { userId: 'u1', createdAt: now - 47 * 60 * MIN };
    const stale = { userId: 'u1', createdAt: now - 49 * 60 * MIN };
    expect(timeDeleteVerdict(stale, { id: 'x', role: 'owner' }, now)).toBe('ok');
    expect(timeDeleteVerdict(fresh, { id: 'u1', role: 'helper' }, now)).toBe('ok');
    expect(timeDeleteVerdict(fresh, { id: 'u1', role: 'custom-operator' }, now)).toBe('ok');
    expect(timeDeleteVerdict(stale, { id: 'u1', role: 'helper' }, now)).toBe('TOO_LATE');
    expect(timeDeleteVerdict(fresh, { id: 'u2', role: 'helper' }, now)).toBe('NOT_YOURS');
    expect(timeDeleteVerdict(fresh, { id: 'u1', role: 'inspector' }, now)).toBe('READ_ONLY');
  });

  it('the schema keeps minutes to 1..720 and the note short', () => {
    expect(taskTimeEntrySchema.safeParse({ startedAt: 1, minutes: 0 }).success).toBe(false);
    expect(taskTimeEntrySchema.safeParse({ startedAt: 1, minutes: 720 }).success).toBe(true);
    expect(
      taskTimeEntrySchema.safeParse({ startedAt: 1, minutes: 5, note: 'x'.repeat(501) }).success
    ).toBe(false);
    expect(taskTimeEntrySchema.safeParse({ startedAt: 0, minutes: 5 }).success).toBe(false);
  });
});
