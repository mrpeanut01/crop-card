// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

// #870: undo a skip (FU870-2), typed shares of the gallons (FU870-1) and
// "running since" (FU870-4) on the waterer endpoints.

const m = vi.hoisted(() => ({ role: 'owner' as string, userId: 'fu870-owner' }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: m.userId, role: m.role, activeOwnerId: 'mocked-owner' });
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

import { db } from '$lib/db/client';
import { irrigationSkips, owners, users } from '$lib/db/schema';
import { runWithTenantAsync, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createEquipment, getEquipment } from '$lib/db/equipment';
import { listIrrigationSkips, listWaterTargets } from '$lib/db/waterers';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { scheduleOf } from '$lib/irrigation/schedule';
import { POST as SKIP } from './+server';
import { DELETE as UNDO } from './[id]/+server';
import { PUT as PUT_TARGETS } from '../../equipment/[id]/water-targets/+server';
import { PATCH as PATCH_EQUIPMENT } from '../../equipment/[id]/+server';
import { POST as CREATE_EQUIPMENT } from '../../equipment/+server';

const BASE = 'http://localhost/api';
type Handler = (event: never) => Response | Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

for (const id of ['fu870-owner', 'fu870-helper', 'fu870-helper-2']) {
  db.insert(users)
    .values({ id, email: `${id}@test.local` })
    .onConflictDoNothing()
    .run();
}

function seedOwner(): string {
  const id = `fu870-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

async function call(
  handler: unknown,
  path: string,
  method: string,
  opts: { params?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: Json }> {
  const url = new URL(`${BASE}${path}`);
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

const SCHEDULE = {
  days: [1, 3, 5],
  start: '06:00',
  minutes: 20,
  method: 'drip',
  inchesPerRun: 0.4
};

function setup() {
  const field = createField({ name: 'Herb garden', kind: 'garden' });
  const bed = createBlock({ name: 'Bed 1', fieldId: field.id });
  const bed2 = createBlock({ name: 'Bed 2', fieldId: field.id });
  const timer = createEquipment({ type: 'irrigation', label: 'Drip timer' });
  return { fieldId: field.id, bedId: bed.id, bed2Id: bed2.id, timerId: timer.id };
}

const patch = (id: string, body: unknown) =>
  call(PATCH_EQUIPMENT, `/equipment/${id}`, 'PATCH', { params: { id }, body });
const putTargets = (id: string, body: unknown) =>
  call(PUT_TARGETS, `/equipment/${id}/water-targets`, 'PUT', { params: { id }, body });
const skip = (body: unknown, headers?: Record<string, string>) =>
  call(SKIP, '/irrigation/skips', 'POST', { body, headers });
const undo = (id: string) => call(UNDO, `/irrigation/skips/${id}`, 'DELETE', { params: { id } });

function as(role: string, userId: string) {
  m.role = role;
  m.userId = userId;
}

async function skipAs(timerId: string, userId: string, role: string, offsetMs: number) {
  as(role, userId);
  const res = await skip({
    equipmentId: timerId,
    scheduledAt: Date.now() + offsetMs,
    reason: 'did-not-run'
  });
  expect(res.status).toBe(201);
  return res.body.skip.id as string;
}

function ageSkip(id: string, hours: number) {
  db.update(irrigationSkips)
    .set({ createdAt: new Date(Date.now() - hours * 3_600_000) })
    .where(withTenant(irrigationSkips, eq(irrigationSkips.id, id)))
    .run();
}

beforeEach(() => as('owner', 'fu870-owner'));

describe('FU870-2: DELETE /api/irrigation/skips/:id', () => {
  it('lets the person who logged it undo within 48 hours, and owners any time', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const mine = await skipAs(s.timerId, 'fu870-helper', 'helper', -3_600_000);
      const res = await undo(mine);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, id: mine });
      expect(listIrrigationSkips({})).toEqual([]);

      const old = await skipAs(s.timerId, 'fu870-helper', 'helper', -7_200_000);
      ageSkip(old, 49);
      const late = await undo(old);
      expect(late.status).toBe(403);
      expect(late.body).toMatchObject({ error: 'TOO_LATE', askOwner: true });
      expect(late.body.message).toMatch(/Ask the owner\.$/);
      as('owner', 'fu870-owner');
      expect((await undo(old)).status).toBe(200);
      expect(listIrrigationSkips({})).toEqual([]);
    });
  });

  it("refuses another person's skip and inspectors, and says to ask the owner", async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const theirs = await skipAs(s.timerId, 'fu870-helper-2', 'helper', 3_600_000);
      as('helper', 'fu870-helper');
      const notYours = await undo(theirs);
      expect(notYours.status).toBe(403);
      expect(notYours.body).toMatchObject({ error: 'NOT_YOURS', askOwner: true });
      expect(notYours.body.message).toMatch(/Ask the owner\.$/);
      as('inspector', 'fu870-helper');
      const readOnly = await undo(theirs);
      expect(readOnly.status).toBe(403);
      expect(readOnly.body.error).toBe('READ_ONLY');
      expect(listIrrigationSkips({})).toHaveLength(1);
    });
  });

  it('answers in Spanish for a Spanish viewer', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const theirs = await skipAs(s.timerId, 'fu870-owner', 'owner', 3_600_000);
      as('helper', 'fu870-helper');
      const url = new URL(`${BASE}/irrigation/skips/${theirs}`);
      const res = await (UNDO as unknown as Handler)({
        params: { id: theirs },
        url,
        request: new Request(url.href, { method: 'DELETE' }),
        locals: { locale: 'es' }
      } as never);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { message: string }).message).toMatch(/dueño\.$/);
    });
  });

  it("reads another farm's skip as missing and leaves it alone", async () => {
    const a = seedOwner();
    const theirs = await runWithTenantAsync(a, async () => {
      const s = setup();
      return skipAs(s.timerId, 'fu870-owner', 'owner', 3_600_000);
    });
    await runWithTenantAsync(seedOwner(), async () => {
      as('owner', 'fu870-owner');
      const res = await undo(theirs);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect((await undo('no-such-skip')).status).toBe(404);
    });
    await runWithTenantAsync(a, async () => expect(listIrrigationSkips({})).toHaveLength(1));
  });

  it('keeps an undone skip undone when the same offline save replays', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const headers = { [CLIENT_RECORD_HEADER]: `skip_${randomUUID()}` };
      const body = {
        equipmentId: s.timerId,
        scheduledAt: Date.now() - 3_600_000,
        reason: 'did-not-run'
      };
      const first = await skip(body, headers);
      expect((await undo(first.body.skip.id)).status).toBe(200);
      const replay = await skip(body, headers);
      expect(replay.body.duplicate).toBe(true);
      expect(listIrrigationSkips({})).toEqual([]);
    });
  });
});

describe('FU870-1: typed shares of the gallons', () => {
  it('stores a full set of shares that totals 100, owner only', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const res = await putTargets(s.timerId, {
        areaIds: [],
        blockIds: [s.bedId, s.bed2Id],
        blockShares: { [s.bedId]: 60, [s.bed2Id]: 40 }
      });
      expect(res.status).toBe(200);
      const byBed = Object.fromEntries(
        listWaterTargets([s.timerId]).map((t) => [t.blockId, t.sharePct])
      );
      expect(byBed).toEqual({ [s.bedId]: 60, [s.bed2Id]: 40 });
      const cleared = await putTargets(s.timerId, { areaIds: [], blockIds: [s.bedId, s.bed2Id] });
      expect(cleared.body.targets.map((t: { sharePct: unknown }) => t.sharePct)).toEqual([
        null,
        null
      ]);
      as('helper', 'fu870-helper');
      const helper = await putTargets(s.timerId, {
        areaIds: [],
        blockIds: [s.bedId, s.bed2Id],
        blockShares: { [s.bedId]: 50, [s.bed2Id]: 50 }
      });
      expect(helper.status).toBe(403);
    });
  });

  it('refuses a partial set, a total other than 100 and a share out of range', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const partial = await putTargets(s.timerId, {
        areaIds: [],
        blockIds: [s.bedId, s.bed2Id],
        blockShares: { [s.bedId]: 100 }
      });
      expect(partial.status).toBe(400);
      expect(partial.body.code).toBe('SHARES_INCOMPLETE');
      const total = await putTargets(s.timerId, {
        areaIds: [],
        blockIds: [s.bedId, s.bed2Id],
        blockShares: { [s.bedId]: 50, [s.bed2Id]: 40 }
      });
      expect(total.status).toBe(400);
      expect(total.body.code).toBe('SHARES_TOTAL');
      for (const bad of [0, 101, 33.5]) {
        const res = await putTargets(s.timerId, {
          areaIds: [],
          blockIds: [s.bedId, s.bed2Id],
          blockShares: { [s.bedId]: bad, [s.bed2Id]: 100 - bad }
        });
        expect(res.status).toBe(400);
      }
      expect(listWaterTargets([s.timerId])).toEqual([]);
    });
  });

  it('drops a share when only one target is left', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const res = await putTargets(s.timerId, {
        areaIds: [s.fieldId],
        blockIds: [s.bedId],
        areaShares: { [s.fieldId]: 100 }
      });
      expect(res.status).toBe(200);
      expect(res.body.targets).toEqual([
        { equipmentId: s.timerId, fieldId: s.fieldId, blockId: null, sharePct: null }
      ]);
    });
  });
});

describe('FU870-4: running since', () => {
  const day = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  it('stores a past day without moving activeFrom, and leaving it out clears it', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      await patch(s.timerId, { spec: { schedule: SCHEDULE } });
      const activeFrom = scheduleOf(getEquipment(s.timerId)?.spec)?.activeFrom;
      const since = day(-5);
      const res = await patch(s.timerId, {
        spec: { schedule: { ...SCHEDULE, runningSince: since } }
      });
      expect(res.status).toBe(200);
      const stored = scheduleOf(getEquipment(s.timerId)?.spec);
      expect(stored?.runningSince).toBe(since);
      expect(stored?.activeFrom).toBe(activeFrom);
      await patch(s.timerId, { spec: { schedule: SCHEDULE } });
      const cleared = scheduleOf(getEquipment(s.timerId)?.spec);
      expect(cleared && 'runningSince' in cleared).toBe(false);
      await patch(s.timerId, { spec: { schedule: { ...SCHEDULE, runningSince: since } } });
      await patch(s.timerId, { spec: { schedule: { ...SCHEDULE, runningSince: null } } });
      expect(scheduleOf(getEquipment(s.timerId)?.spec)?.runningSince).toBeUndefined();
    });
  });

  it('refuses a day after today and a day that does not exist, on edit and on create', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const future = await patch(s.timerId, {
        spec: { schedule: { ...SCHEDULE, runningSince: day(3) } }
      });
      expect(future.status).toBe(400);
      expect(future.body.code).toBe('IN_THE_FUTURE');
      const bad = await patch(s.timerId, {
        spec: { schedule: { ...SCHEDULE, runningSince: '2026-02-30' } }
      });
      expect(bad.status).toBe(400);
      const create = await call(CREATE_EQUIPMENT, '/equipment', 'POST', {
        body: {
          type: 'irrigation',
          label: 'Soaker',
          spec: { schedule: { ...SCHEDULE, runningSince: day(3) } }
        }
      });
      expect(create.status).toBe(400);
      expect(create.body.code).toBe('IN_THE_FUTURE');
      expect(scheduleOf(getEquipment(s.timerId)?.spec)).toBeNull();
    });
  });
});
