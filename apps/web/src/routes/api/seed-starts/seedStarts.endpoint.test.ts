// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'seed-user', role: m.role });
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

import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners, tasks, users } from '$lib/db/schema';
import { runWithTenantAsync, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { getSeedStart, listSeedStartsForCrops } from '$lib/db/seedStarts';
import { createCloseout } from '$lib/db/seasonCloseouts';
import { seasonYearOf } from '$lib/server/seasonClose';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { seedStartTaskId } from '$lib/schedule/seedStart';
import { POST as ADD_PLANTING } from '../blocks/[id]/plantings/+server';
import { POST as GARDEN_PLANTINGS } from '../garden/plantings/+server';
import { PATCH as PATCH_CROP } from '../crops/[id]/+server';
import { POST as CLOSE_TASK } from '../tasks/close/+server';
import { POST as CREATE_TRAY, GET as LIST_TRAYS } from './+server';
import { PATCH as PATCH_TRAY } from './[id]/+server';
import { POST as PROGRESS } from './[id]/progress/+server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86_400_000;
const utc = (s: string) => Date.parse(`${s}T00:00:00Z`);

function seedOwner(): string {
  const id = `seed-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'seed-user', email: 'seed@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

async function call(
  handler: unknown,
  path: string,
  method: string,
  opts: { params?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: Json }> {
  const url = new URL(`http://localhost/api${path}`);
  try {
    const res = await (handler as (e: never) => Promise<Response>)({
      params: opts.params ?? {},
      url,
      request: new Request(url.href, {
        method,
        headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      }),
      locals: {}
    } as never);
    return { status: res.status, body: (await res.json()) as Json };
  } catch (e) {
    const err = e as { status?: number; body?: Json };
    if (err.status) return { status: err.status, body: err.body ?? {} };
    throw e;
  }
}

function bed() {
  const area = createField({ name: 'Kitchen', kind: 'garden', widthFt: 20, lengthFt: 30 });
  return createBlock({
    name: 'Bed 3',
    fieldId: area.id,
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    xFt: 1,
    yFt: 1,
    bedStyle: 'raised'
  });
}

function seedTasks(cropId: string) {
  return db
    .select()
    .from(tasks)
    .where(withTenant(tasks, eq(tasks.cropId, cropId)))
    .all()
    .filter((t) => t.pluginTemplateKey?.startsWith('seedstart:'))
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}

async function plant(blockId: string, body: Json) {
  return call(ADD_PLANTING, `/blocks/${blockId}/plantings`, 'POST', {
    params: { id: blockId },
    body
  });
}

beforeEach(() => {
  m.role = 'owner';
});

describe('Seed or seedling on POST /api/blocks/[id]/plantings', () => {
  it('seedling started indoors creates three dated tasks backed off the in-ground date', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const inGround = utc('2027-05-10');
      const res = await plant(b.id, {
        cropPluginId: 'cabbage-red-acre',
        plantingDate: inGround,
        establishment: 'transplant',
        startIndoors: true
      });
      expect(res.status).toBe(201);
      const id = res.body.planting.id as string;
      expect(getCrop(id)?.establishment).toBe('transplant');
      const rows = seedTasks(id);
      expect(rows.map((t) => [t.id, t.scheduledFor.getTime(), t.category])).toEqual([
        [seedStartTaskId(id, 'sow'), inGround - 35 * DAY, 'plant'],
        [seedStartTaskId(id, 'harden'), inGround - 14 * DAY, 'other'],
        [seedStartTaskId(id, 'transplant'), inGround, 'plant']
      ]);
      expect(rows.map((t) => t.title)).toEqual([
        'Sow Cabbage Red Acre indoors',
        'Start hardening off Cabbage Red Acre',
        'Transplant Cabbage Red Acre to Bed 3'
      ]);
      expect(rows[0].blockId).toBe(b.id);
    });
  });

  it('bought seedlings, direct seed and no answer create no tasks', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const base = { cropPluginId: 'cabbage-red-acre', plantingDate: utc('2027-05-10') };
      const bought = await plant(b.id, {
        ...base,
        establishment: 'transplant',
        startIndoors: false
      });
      const direct = await plant(b.id, { ...base, establishment: 'direct-seed' });
      const none = await plant(b.id, base);
      expect(seedTasks(bought.body.planting.id)).toEqual([]);
      expect(seedTasks(direct.body.planting.id)).toEqual([]);
      expect(seedTasks(none.body.planting.id)).toEqual([]);
      expect(getCrop(none.body.planting.id)?.establishment).toBeUndefined();
      expect(getCrop(direct.body.planting.id)?.establishment).toBe('direct-seed');
    });
  });

  it('says timing is not known and takes the owner sow date instead of guessing', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const inGround = utc('2027-05-20');
      const unknown = await plant(b.id, {
        cropPluginId: 'tomato-roma-vf',
        plantingDate: inGround,
        establishment: 'transplant'
      });
      expect(unknown.body.seedStart.notes).toContain(
        'Indoor start timing is not known for this crop. Set the sow date yourself.'
      );
      expect(seedTasks(unknown.body.planting.id).map((t) => t.id)).toEqual([
        seedStartTaskId(unknown.body.planting.id, 'transplant')
      ]);
      const own = await plant(b.id, {
        cropPluginId: 'tomato-roma-vf',
        plantingDate: inGround,
        establishment: 'transplant',
        sowIndoorsOn: utc('2027-03-25')
      });
      const rows = seedTasks(own.body.planting.id);
      expect(rows[0]).toMatchObject({ id: seedStartTaskId(own.body.planting.id, 'sow') });
      expect(rows[0].scheduledFor.getTime()).toBe(utc('2027-03-25'));
      expect(rows.at(-1)?.body).toBe('Harden off first. Timing is not known for this crop.');
    });
  });

  it('keeps a past sow date and says it is late', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const inGround = Date.now() + 10 * DAY;
      const res = await plant(b.id, {
        cropPluginId: 'cabbage-red-acre',
        plantingDate: inGround,
        establishment: 'transplant'
      });
      const sow = seedTasks(res.body.planting.id)[0];
      expect(sow.scheduledFor.getTime()).toBe(inGround - 35 * DAY);
      expect(sow.body).toContain("You're past the usual start. Sow now or buy seedlings.");
    });
  });
});

describe('PATCH /api/crops/:id', () => {
  it('set-establishment aborts open rows, keeps done ones and reopens them idempotently', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const res = await plant(b.id, {
        cropPluginId: 'cabbage-red-acre',
        plantingDate: utc('2027-05-10'),
        establishment: 'transplant'
      });
      const id = res.body.planting.id as string;
      const close = await call(CLOSE_TASK, '/tasks/close', 'POST', {
        body: { taskId: seedStartTaskId(id, 'sow'), action: 'complete' }
      });
      expect(close.status).toBe(200);
      expect(close.body.seedStart).toEqual({ step: 'sow', cropId: id });

      const toDirect = await call(PATCH_CROP, `/crops/${id}`, 'PATCH', {
        params: { id },
        body: { action: 'set-establishment', establishment: 'direct-seed' }
      });
      expect(toDirect.status).toBe(200);
      const after = seedTasks(id);
      expect(after.find((t) => t.id.endsWith('_sow'))?.completedAt).not.toBeNull();
      expect(
        after.filter((t) => !t.id.endsWith('_sow')).every((t) => t.abortReason === 'plan-edited')
      ).toBe(true);

      for (let i = 0; i < 2; i++) {
        const back = await call(PATCH_CROP, `/crops/${id}`, 'PATCH', {
          params: { id },
          body: { action: 'set-establishment', establishment: 'transplant', startIndoors: true }
        });
        expect(back.status).toBe(200);
      }
      const reopened = seedTasks(id);
      expect(reopened).toHaveLength(3);
      expect(reopened.filter((t) => t.abortedAt === null && t.completedAt === null)).toHaveLength(
        2
      );
      expect(reopened.find((t) => t.id.endsWith('_sow'))?.completedAt).not.toBeNull();
    });
  });

  it('is owner only', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const res = await plant(b.id, {
        cropPluginId: 'cabbage-red-acre',
        plantingDate: utc('2027-05-10')
      });
      m.role = 'helper';
      const r = await call(PATCH_CROP, `/crops/x`, 'PATCH', {
        params: { id: res.body.planting.id },
        body: { action: 'set-establishment', establishment: 'direct-seed' }
      });
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('Ask the owner.');
    });
  });

  it('set-schedule gives an undated transplant its tasks, and moving the date moves them', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const res = await plant(b.id, {
        cropPluginId: 'cabbage-red-acre',
        establishment: 'transplant',
        startIndoors: true
      });
      const id = res.body.planting.id as string;
      expect(res.body.seedStart.notes).toContain(
        'Seed-start tasks are made once the planting has a date.'
      );
      expect(seedTasks(id)).toEqual([]);
      const d1 = utc('2027-05-10');
      await call(PATCH_CROP, `/crops/${id}`, 'PATCH', {
        params: { id },
        body: { action: 'set-schedule', plantingDate: d1 }
      });
      expect(seedTasks(id).map((t) => t.scheduledFor.getTime())).toEqual([
        d1 - 35 * DAY,
        d1 - 14 * DAY,
        d1
      ]);
      await call(PATCH_CROP, `/crops/${id}`, 'PATCH', {
        params: { id },
        body: { action: 'set-schedule', plantingDate: d1 + 7 * DAY }
      });
      expect(seedTasks(id).map((t) => t.scheduledFor.getTime())).toEqual([
        d1 - 28 * DAY,
        d1 - 7 * DAY,
        d1 + 7 * DAY
      ]);
    });
  });
  it('keeps a bought-seedlings answer on an undated planting once it gets a date', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const res = await plant(b.id, {
        cropPluginId: 'cabbage-red-acre',
        establishment: 'transplant',
        startIndoors: false
      });
      const id = res.body.planting.id as string;
      await call(PATCH_CROP, `/crops/${id}`, 'PATCH', {
        params: { id },
        body: { action: 'set-schedule', plantingDate: utc('2027-05-10') }
      });
      expect(seedTasks(id)).toEqual([]);

      await call(PATCH_CROP, `/crops/${id}`, 'PATCH', {
        params: { id },
        body: { action: 'set-establishment', establishment: 'transplant', startIndoors: true }
      });
      expect(seedTasks(id)).toHaveLength(3);
    });
  });
});

describe('POST /api/garden/plantings', () => {
  it('writes seed-start tasks inside the batch', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const inGround = utc('2027-08-20');
      const res = await call(GARDEN_PLANTINGS, '/garden/plantings', 'POST', {
        body: {
          plantings: [
            {
              blockId: b.id,
              cropPluginId: 'broccoli-de-cicco',
              varietyDisplayName: 'Fall broccoli',
              plantingDateMs: inGround,
              footprint: { x_in: 0, y_in: 0, w_in: 24, l_in: 24 },
              spacingPattern: 'square',
              source: 'manual',
              establishment: 'transplant',
              startIndoors: true
            }
          ]
        }
      });
      expect(res.status).toBe(201);
      const id = res.body.plantings[0].cropId as string;
      expect(seedTasks(id)[0].scheduledFor.getTime()).toBe(utc('2027-07-16'));
    });
  });
});

describe('trays', () => {
  async function planting() {
    const b = bed();
    const res = await plant(b.id, {
      cropPluginId: 'cabbage-red-acre',
      plantingDate: utc('2027-05-10'),
      establishment: 'transplant'
    });
    return res.body.planting.id as string;
  }

  it('owner logs trays; sown_indoors_at is the earliest sowing', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const cropId = await planting();
      const t1 = await call(CREATE_TRAY, '/seed-starts', 'POST', {
        body: { cropId, sownAt: utc('2026-04-05'), trayLabel: 'Tray A', cells: 72, seedsPerCell: 1 }
      });
      expect(t1.status).toBe(201);
      await call(CREATE_TRAY, '/seed-starts', 'POST', {
        body: { cropId, sownAt: utc('2026-04-01'), cells: 36 }
      });
      expect(getCrop(cropId)?.sownIndoorsAt).toBe(utc('2026-04-01'));
      const patched = await call(PATCH_TRAY, `/seed-starts/x`, 'PATCH', {
        params: { id: t1.body.tray.id },
        body: { sownAt: utc('2026-03-30') }
      });
      expect(patched.body.tray.sownAt).toBe(utc('2026-03-30'));
      expect(getCrop(cropId)?.sownIndoorsAt).toBe(utc('2026-03-30'));
      const list = await call(LIST_TRAYS, `/seed-starts?cropId=${cropId}`, 'GET');
      expect(list.body.trays).toHaveLength(2);
    });
  });

  it('refuses a helper tray and a future sowing, and another farm crop', async () => {
    const other = seedOwner();
    const foreignCrop = await runWithTenantAsync(other, planting);
    await runWithTenantAsync(seedOwner(), async () => {
      const cropId = await planting();
      m.role = 'helper';
      expect(
        (
          await call(CREATE_TRAY, '/seed-starts', 'POST', {
            body: { cropId, sownAt: utc('2026-04-01') }
          })
        ).status
      ).toBe(403);
      m.role = 'owner';
      expect(
        (
          await call(CREATE_TRAY, '/seed-starts', 'POST', {
            body: { cropId, sownAt: Date.now() + 2 * DAY }
          })
        ).body.code
      ).toBe('IN_THE_FUTURE');
      const foreign = await call(CREATE_TRAY, '/seed-starts', 'POST', {
        body: { cropId: foreignCrop, sownAt: utc('2026-04-01') }
      });
      expect(foreign.status).toBe(400);
      expect(foreign.body.error).toBe('unknown cropId');
    });
  });

  it('helpers record germination; the latest observation wins and replays are idempotent', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const cropId = await planting();
      const tray = (
        await call(CREATE_TRAY, '/seed-starts', 'POST', {
          body: { cropId, sownAt: utc('2026-04-01'), cells: 72, seedsPerCell: 1 }
        })
      ).body.tray;
      m.role = 'helper';
      const at = (d: string) => utc(d);
      const newer = await call(PROGRESS, `/seed-starts/x/progress`, 'POST', {
        params: { id: tray.id },
        body: { germinatedCount: 40, observedAt: at('2026-04-10') },
        headers: { [CLIENT_RECORD_HEADER]: 'rec-germ-0001' }
      });
      expect(newer.status).toBe(201);
      const replay = await call(PROGRESS, `/seed-starts/x/progress`, 'POST', {
        params: { id: tray.id },
        body: { germinatedCount: 40, observedAt: at('2026-04-10') },
        headers: { [CLIENT_RECORD_HEADER]: 'rec-germ-0001' }
      });
      expect(replay.body.duplicate).toBe(true);
      const older = await call(PROGRESS, `/seed-starts/x/progress`, 'POST', {
        params: { id: tray.id },
        body: { germinatedCount: 12, observedAt: at('2026-04-08') }
      });
      expect(older.body.countApplied).toBe(false);
      expect(getSeedStart(tray.id)?.germinatedCount).toBe(40);
      const over = await call(PROGRESS, `/seed-starts/x/progress`, 'POST', {
        params: { id: tray.id },
        body: { germinatedCount: 73 }
      });
      expect(over.body.code).toBe('OVER_TRAY');
      m.role = 'inspector';
      expect(
        (
          await call(PROGRESS, `/seed-starts/x/progress`, 'POST', {
            params: { id: tray.id },
            body: { germinatedCount: 1 }
          })
        ).status
      ).toBe(403);
    });
  });

  it('closing the Transplant task stamps the trays that have no transplant date', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const cropId = await planting();
      const tray = (
        await call(CREATE_TRAY, '/seed-starts', 'POST', {
          body: { cropId, sownAt: utc('2026-04-01') }
        })
      ).body.tray;
      await call(CLOSE_TASK, '/tasks/close', 'POST', {
        body: { taskId: seedStartTaskId(cropId, 'transplant'), action: 'complete' }
      });
      expect(getSeedStart(tray.id)?.transplantedAt).not.toBeNull();
      expect(listSeedStartsForCrops([cropId])).toHaveLength(1);
    });
  });

  it('SEASON_CLOSED never gates seed starting (E0-6)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const cropId = await planting();
      createCloseout({ year: seasonYearOf(Date.now()), snapshotJson: '{}' });
      const tray = await call(CREATE_TRAY, '/seed-starts', 'POST', {
        body: { cropId, sownAt: Date.now() - DAY }
      });
      expect(tray.status).toBe(201);
      const prog = await call(PROGRESS, `/seed-starts/x/progress`, 'POST', {
        params: { id: tray.body.tray.id },
        body: { germinatedCount: 3 }
      });
      expect(prog.status).toBe(201);
    });
  });
});
