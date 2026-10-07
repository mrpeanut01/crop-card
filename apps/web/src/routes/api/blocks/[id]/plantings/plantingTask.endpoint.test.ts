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
import { POST as ADD_PLANTING } from './+server';
import { PATCH as PATCH_CROP } from '../../../crops/[id]/+server';
import { plantingTaskId } from '$lib/tasks/plantingTask';
import { taskDisplayTitle } from '$lib/tasks/title';

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

function plantTasks(cropId: string) {
  return db
    .select()
    .from(tasks)
    .where(withTenant(tasks, eq(tasks.cropId, cropId)))
    .all()
    .filter((t) => t.category === 'plant')
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

const future = (days: number) => Math.floor(Date.now() / DAY) * DAY + days * DAY;

describe('a dated planting gets its own plant task (#712)', () => {
  it('direct seed, bought seedlings and no answer each get one dated task', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const date = future(20);
      const base = { cropPluginId: 'cabbage-red-acre', plantingDate: date };
      const direct = await plant(b.id, { ...base, establishment: 'direct-seed' });
      const bought = await plant(b.id, {
        ...base,
        establishment: 'transplant',
        startIndoors: false
      });
      const none = await plant(b.id, base);
      const cases: [Json, string][] = [
        [direct, 'Sow Cabbage Red Acre in Bed 3'],
        [bought, 'Transplant Cabbage Red Acre to Bed 3'],
        [none, 'Plant Cabbage Red Acre in Bed 3']
      ];
      for (const [res, title] of cases) {
        const id = res.body.planting.id as string;
        const rows = plantTasks(id);
        expect(rows.map((t) => [t.id, t.title, t.scheduledFor.getTime(), t.kind])).toEqual([
          [plantingTaskId(id), title, date, 'primary']
        ]);
        expect(rows[0].blockId).toBe(b.id);
      }
      expect(
        taskDisplayTitle(
          { title: 'Sow Cabbage Red Acre in Bed 3', pluginTemplateKey: `planting:x` },
          'es'
        )
      ).toBe('Sembrar Cabbage Red Acre en Bed 3');
    });
  });

  it('a seedling started indoors keeps only its Transplant step', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const res = await plant(b.id, {
        cropPluginId: 'cabbage-red-acre',
        plantingDate: future(60),
        establishment: 'transplant',
        startIndoors: true
      });
      const id = res.body.planting.id as string;
      const plant_ = plantTasks(id);
      expect(plant_.map((t) => t.pluginTemplateKey?.split(':')[0])).toEqual([
        'seedstart',
        'seedstart'
      ]);
    });
  });

  it('undated and past plantings get none; a first date adds it and a move carries it', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const past = await plant(b.id, {
        cropPluginId: 'cabbage-red-acre',
        plantingDate: Date.now() - 10 * DAY
      });
      expect(plantTasks(past.body.planting.id)).toEqual([]);
      const undated = await plant(b.id, { cropPluginId: 'cabbage-red-acre' });
      const id = undated.body.planting.id as string;
      expect(plantTasks(id)).toEqual([]);
      const first = future(15);
      const dated = await call(PATCH_CROP, `/crops/${id}`, 'PATCH', {
        params: { id },
        body: { action: 'set-schedule', plantingDate: first }
      });
      expect(dated.status).toBe(200);
      expect(plantTasks(id).map((t) => t.scheduledFor.getTime())).toEqual([first]);
      const moved = future(22);
      await call(PATCH_CROP, `/crops/${id}`, 'PATCH', {
        params: { id },
        body: { action: 'set-schedule', plantingDate: moved }
      });
      expect(plantTasks(id).map((t) => [t.id, t.scheduledFor.getTime()])).toEqual([
        [plantingTaskId(id), moved]
      ]);
    });
  });

  it('switching to start indoors steps aside, and back to direct seed returns', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const res = await plant(b.id, {
        cropPluginId: 'cabbage-red-acre',
        plantingDate: future(60),
        establishment: 'direct-seed'
      });
      const id = res.body.planting.id as string;
      const patch = (body: Json) =>
        call(PATCH_CROP, `/crops/${id}`, 'PATCH', { params: { id }, body });
      await patch({ action: 'set-establishment', establishment: 'transplant', startIndoors: true });
      const own = () => plantTasks(id).find((t) => t.id === plantingTaskId(id));
      expect(own()?.abortedAt).not.toBeNull();
      await patch({ action: 'set-establishment', establishment: 'direct-seed' });
      expect(own()?.abortedAt).toBeNull();
      expect(own()?.title).toBe('Sow Cabbage Red Acre in Bed 3');
    });
  });
});
