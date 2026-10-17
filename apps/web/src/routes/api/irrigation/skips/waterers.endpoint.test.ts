// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string, userId: 'waterer-owner' }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: m.userId, role: m.role });
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
import { owners, users } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createEquipment, getEquipment } from '$lib/db/equipment';
import { listIrrigationSkips, listWaterTargets } from '$lib/db/waterers';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { scheduleOf } from '$lib/irrigation/schedule';
import { GET as LIST_SKIPS, POST as SKIP } from './+server';
import { GET as TARGETS, PUT as PUT_TARGETS } from '../../equipment/[id]/water-targets/+server';
import { PATCH as PATCH_EQUIPMENT } from '../../equipment/[id]/+server';
import { POST as CREATE_EQUIPMENT } from '../../equipment/+server';

const BASE = 'http://localhost/api';
type Handler = (event: never) => Response | Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

for (const id of ['waterer-owner', 'waterer-helper']) {
  db.insert(users)
    .values({ id, email: `${id}@test.local` })
    .onConflictDoNothing()
    .run();
}

function seedOwner(): string {
  const id = `waterer-ep-${randomUUID()}`;
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
  const timer = createEquipment({ type: 'irrigation', label: 'Drip timer' });
  const sprayer = createEquipment({ type: 'sprayer', label: 'Backpack' });
  return { fieldId: field.id, bedId: bed.id, timerId: timer.id, sprayerId: sprayer.id };
}

const patch = (id: string, body: unknown) =>
  call(PATCH_EQUIPMENT, `/equipment/${id}`, 'PATCH', { params: { id }, body });
const putTargets = (id: string, body: unknown) =>
  call(PUT_TARGETS, `/equipment/${id}/water-targets`, 'PUT', { params: { id }, body });
const skip = (body: unknown, headers?: Record<string, string>) =>
  call(SKIP, '/irrigation/skips', 'POST', { body, headers });

beforeEach(() => {
  m.role = 'owner';
  m.userId = 'waterer-owner';
});

describe('waterer schedule on the equipment API', () => {
  it('stores a schedule on a waterer with the time it was set, and keeps it when unchanged', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const first = await patch(s.timerId, { spec: { schedule: SCHEDULE } });
      expect(first.status).toBe(200);
      const stored = scheduleOf(getEquipment(s.timerId)?.spec);
      expect(stored).toMatchObject({ ...SCHEDULE, gallonsPerMinute: null });
      expect(stored?.activeFrom).toBeGreaterThan(Date.now() - 60_000);
      const again = await patch(s.timerId, {
        spec: { schedule: { ...SCHEDULE, days: [5, 3, 1] } }
      });
      expect(again.status).toBe(200);
      expect(scheduleOf(getEquipment(s.timerId)?.spec)?.activeFrom).toBe(stored?.activeFrom);
      await patch(s.timerId, { spec: { schedule: null } });
      expect(scheduleOf(getEquipment(s.timerId)?.spec)).toBeNull();
    });
  });

  it('refuses a schedule on a sprayer, sprayer fields on a waterer, and a bad schedule', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      expect((await patch(s.sprayerId, { spec: { schedule: SCHEDULE } })).status).toBe(400);
      expect((await patch(s.timerId, { spec: { tankGal: 4 } })).status).toBe(400);
      expect(
        (await patch(s.timerId, { spec: { schedule: { ...SCHEDULE, start: '25:00' } } })).status
      ).toBe(400);
    });
  });

  it('is owner only', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      m.role = 'helper';
      expect((await patch(s.timerId, { spec: { schedule: SCHEDULE } })).status).toBe(403);
    });
  });

  it('validates a schedule sent on create, for waterers only', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const ok = await call(CREATE_EQUIPMENT, '/equipment', 'POST', {
        body: { type: 'irrigation', label: 'Soaker', spec: { schedule: SCHEDULE } }
      });
      expect(ok.status).toBe(201);
      expect(scheduleOf(ok.body.equipment.spec)?.activeFrom).toBeGreaterThan(0);
      const bad = await call(CREATE_EQUIPMENT, '/equipment', 'POST', {
        body: { type: 'irrigation', label: 'Soaker', spec: { schedule: { days: [] } } }
      });
      expect(bad.status).toBe(400);
      const sprayer = await call(CREATE_EQUIPMENT, '/equipment', 'POST', {
        body: { type: 'sprayer', label: 'Sprayer', spec: { schedule: SCHEDULE } }
      });
      expect(sprayer.status).toBe(400);
    });
  });
});

describe('PUT /api/equipment/:id/water-targets', () => {
  it('replaces the targets, dropping a bed inside an Area covered whole', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const res = await putTargets(s.timerId, { areaIds: [s.fieldId], blockIds: [s.bedId] });
      expect(res.status).toBe(200);
      expect(res.body.targets).toEqual([
        { equipmentId: s.timerId, fieldId: s.fieldId, blockId: null }
      ]);
      const bedOnly = await putTargets(s.timerId, { areaIds: [], blockIds: [s.bedId, s.bedId] });
      expect(bedOnly.body.targets).toEqual([
        { equipmentId: s.timerId, fieldId: s.fieldId, blockId: s.bedId }
      ]);
      const read = await call(TARGETS, `/equipment/${s.timerId}/water-targets`, 'GET', {
        params: { id: s.timerId }
      });
      expect(read.body.targets).toHaveLength(1);
    });
  });

  it('is owner only, for waterers, and refuses another farm ids', async () => {
    const a = seedOwner();
    const sa = await runWithTenantAsync(a, async () => setup());
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      expect((await putTargets(s.sprayerId, { areaIds: [s.fieldId], blockIds: [] })).status).toBe(
        400
      );
      const foreign = await putTargets(s.timerId, { areaIds: [sa.fieldId], blockIds: [] });
      expect(foreign.status).toBe(400);
      const foreignBed = await putTargets(s.timerId, { areaIds: [], blockIds: [sa.bedId] });
      expect(foreignBed.status).toBe(400);
      expect((await putTargets(sa.timerId, { areaIds: [], blockIds: [] })).status).toBe(404);
      m.role = 'helper';
      expect((await putTargets(s.timerId, { areaIds: [s.fieldId], blockIds: [] })).status).toBe(
        403
      );
      expect(listWaterTargets([s.timerId])).toEqual([]);
    });
    await runWithTenantAsync(a, async () => expect(listWaterTargets()).toEqual([]));
  });
});

describe('POST /api/irrigation/skips', () => {
  it('lets owners and helpers skip a run, once, and inspectors only read', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const at = Date.now() + 3_600_000;
      const body = { equipmentId: s.timerId, scheduledAt: at, reason: 'turned-off-for-rain' };
      m.role = 'helper';
      m.userId = 'waterer-helper';
      const first = await skip(body);
      expect(first.status).toBe(201);
      expect(first.body.skip).toMatchObject({ scheduledAt: at, createdBy: 'waterer-helper' });
      const repeat = await skip({ ...body, reason: 'other' });
      expect(repeat.status).toBe(200);
      expect(repeat.body.skip.id).toBe(first.body.skip.id);
      m.role = 'inspector';
      expect((await skip(body)).status).toBe(403);
      const list = await call(LIST_SKIPS, `/irrigation/skips?equipmentId=${s.timerId}`, 'GET');
      expect(list.body.skips).toHaveLength(1);
    });
  });

  it('replays from the offline queue without saving twice', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const headers = { [CLIENT_RECORD_HEADER]: `skip_${randomUUID()}` };
      const body = {
        equipmentId: s.timerId,
        scheduledAt: Date.now() - 3_600_000,
        reason: 'did-not-run'
      };
      expect((await skip(body, headers)).status).toBe(201);
      const again = await skip(body, headers);
      expect(again.body.duplicate).toBe(true);
      expect(listIrrigationSkips({})).toHaveLength(1);
    });
  });

  it('refuses another farm timer, a sprayer and a run too far off', async () => {
    const a = seedOwner();
    const sa = await runWithTenantAsync(a, async () => setup());
    await runWithTenantAsync(seedOwner(), async () => {
      const s = setup();
      const now = Date.now();
      expect(
        (await skip({ equipmentId: sa.timerId, scheduledAt: now, reason: 'other' })).status
      ).toBe(400);
      expect(
        (await skip({ equipmentId: s.sprayerId, scheduledAt: now, reason: 'other' })).status
      ).toBe(400);
      const far = await skip({
        equipmentId: s.timerId,
        scheduledAt: now - 9 * 86_400_000,
        reason: 'other'
      });
      expect(far.status).toBe(400);
      expect(far.body.code).toBe('OUT_OF_RANGE');
      expect(listIrrigationSkips({})).toEqual([]);
    });
    await runWithTenantAsync(a, async () => expect(listIrrigationSkips({})).toEqual([]));
  });
});
