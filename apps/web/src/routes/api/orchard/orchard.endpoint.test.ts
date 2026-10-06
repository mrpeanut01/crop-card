// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'orch-user', role: m.role });
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
import { addPlanting, createBlock } from '$lib/db/blocks';
import { createField } from '$lib/db/fields';
import { setSetting } from '$lib/db/settings';
import { getTask } from '$lib/db/tasks';
import { getAudienceOverride, getStageMarks } from '$lib/db/orchardCalendar';
import { FARM_PROFILE_KEY } from '$lib/onboarding/profile';
import { orchardYear } from '$lib/server/orchardCalendar.server';
import { GET as getPlanting } from './plantings/[id]/+server';
import { PUT as putStage } from './plantings/[id]/stage/+server';
import { POST as postScout } from './plantings/[id]/scout-task/+server';
import { PUT as putAudience } from './areas/[id]/audience/+server';
import { GET as getArea } from './areas/[id]/+server';

function seedOwner(): string {
  const id = `orch-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedOrchard(opts: { kind?: 'orchard' | 'garden'; crop?: string; profile?: string } = {}) {
  if (opts.profile) setSetting(FARM_PROFILE_KEY, opts.profile);
  const area = createField({ name: 'Back orchard', kind: opts.kind ?? 'orchard' });
  const block = createBlock({ name: 'Row 1', fieldId: area.id });
  const planting = addPlanting({
    blockId: block.id,
    cropPluginId: opts.crop ?? 'apple-gala',
    varietyDisplayName: 'Gala apple',
    plantingDate: Date.UTC(2024, 3, 1)
  });
  return { area, block, planting };
}

async function call(
  handler: (e: never) => Promise<Response> | Response,
  id: string,
  method: string,
  body?: unknown
) {
  const url = new URL(`http://localhost/api/orchard/x/${id}`);
  try {
    const res = await handler({
      params: { id },
      url,
      request: new Request(url, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      locals: {}
    } as never);
    return { status: res.status, body: await res.json() };
  } catch (e) {
    if ((e as { status?: number }).status === undefined) throw e;
    return { status: (e as { status: number }).status, body: {} as Record<string, unknown> };
  }
}

beforeEach(() => {
  m.role = 'owner';
  db.insert(users)
    .values({ id: 'orch-user', email: 'orch-user@example.test' })
    .onConflictDoNothing()
    .run();
});

describe('orchard calendar API (#562)', () => {
  it('picks the guide per Area and says why (OP-4)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = seedOrchard({ profile: 'farm' });
      const r = await call(getPlanting, farm.planting.id, 'GET');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        status: 'calendar',
        audience: { audience: 'commercial', reason: 'farm-profile' },
        calendar: { pluginId: 'pome-va-2026', publicationId: 'VCE 456-419' }
      });
      const garden = seedOrchard({ kind: 'garden' });
      expect((await call(getPlanting, garden.planting.id, 'GET')).body).toMatchObject({
        audience: { audience: 'home', reason: 'garden-area' },
        calendar: { pluginId: 'pome-home-va-2026' }
      });
    });
  });

  it('a crop with no calendar says so; a crop that never has one says nothing', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const fig = seedOrchard({ crop: 'fig-celeste', profile: 'farm' });
      expect((await call(getPlanting, fig.planting.id, 'GET')).body.status).toBe('none');
      const corn = seedOrchard({ crop: 'corn-sweet-incredible' });
      const out = await call(getPlanting, corn.planting.id, 'GET');
      expect([200, 404]).toContain(out.status);
      if (out.status === 200) expect(out.body.status).toBe('none-wanted');
    });
  });

  it('owners and helpers mark a stage; inspectors cannot; unknown stages are refused', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { block, planting } = seedOrchard({ profile: 'farm' });
      m.role = 'helper';
      const ok = await call(putStage, planting.id, 'PUT', { stageId: 'pink' });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ stage: { id: 'pink' }, mark: { stageId: 'pink' } });
      expect(getStageMarks(block.id, orchardYear())['pome-va-2026']).toMatchObject({
        stageId: 'pink',
        markedBy: 'orch-user'
      });
      expect((await call(putStage, planting.id, 'PUT', { stageId: 'shuck-split' })).body.code).toBe(
        'UNKNOWN_STAGE'
      );
      m.role = 'inspector';
      expect((await call(putStage, planting.id, 'PUT', { stageId: 'bloom' })).status).toBe(403);
      m.role = 'owner';
      expect((await call(putStage, planting.id, 'PUT', { stageId: null })).status).toBe(200);
      expect(getStageMarks(block.id, orchardYear())).toEqual({});
    });
  });

  it("another Owner's planting or Area reads as missing (Invariant 6)", async () => {
    let plantingId = '';
    let areaId = '';
    await runWithTenantAsync(seedOwner(), async () => {
      const s = seedOrchard({ profile: 'farm' });
      plantingId = s.planting.id;
      areaId = s.area.id;
    });
    await runWithTenantAsync(seedOwner(), async () => {
      expect((await call(getPlanting, plantingId, 'GET')).status).toBe(404);
      expect((await call(putStage, plantingId, 'PUT', { stageId: 'pink' })).status).toBe(404);
      expect((await call(postScout, plantingId, 'POST', { windowId: 'pink-traps' })).status).toBe(
        404
      );
      expect((await call(putAudience, areaId, 'PUT', { audience: 'home' })).status).toBe(404);
      expect((await call(getArea, areaId, 'GET')).status).toBe(404);
    });
  });

  it('the guide choice is owner only and commercial needs a confirmation', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { area, planting } = seedOrchard({ kind: 'garden' });
      m.role = 'helper';
      expect((await call(putAudience, area.id, 'PUT', { audience: 'home' })).status).toBe(403);
      m.role = 'owner';
      const refused = await call(putAudience, area.id, 'PUT', { audience: 'commercial' });
      expect(refused).toMatchObject({ status: 400, body: { code: 'CONFIRM_COMMERCIAL' } });
      expect(getAudienceOverride(area.id)).toBeNull();
      const ok = await call(putAudience, area.id, 'PUT', {
        audience: 'commercial',
        confirmCommercial: true
      });
      expect(ok.status).toBe(200);
      expect((await call(getPlanting, planting.id, 'GET')).body).toMatchObject({
        audience: { audience: 'commercial', reason: 'override', provenance: 'manual' }
      });
      await call(putAudience, area.id, 'PUT', { audience: null });
      expect(getAudienceOverride(area.id)).toBeNull();
    });
  });

  it('schedules one scouting task per window and year, never a spray task (OC-7)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { block, planting } = seedOrchard({ profile: 'farm' });
      m.role = 'helper';
      const first = await call(postScout, planting.id, 'POST', { windowId: 'pink-traps' });
      expect(first.status).toBe(201);
      const task = getTask(first.body.task.id)!;
      expect(task).toMatchObject({
        blockId: block.id,
        cropId: planting.id,
        category: 'scout',
        kind: 'primary'
      });
      expect(task.title).toMatch(/^Scout: /);
      expect(task.title).not.toMatch(/spray/i);
      expect(task.body ?? null).toBeNull();
      const again = await call(postScout, planting.id, 'POST', { windowId: 'pink-traps' });
      expect(again).toMatchObject({ status: 200, body: { alreadyScheduled: true } });
      expect(again.body.task.id).toBe(task.id);
      const sanitation = await call(postScout, planting.id, 'POST', {
        windowId: 'dormant-blight-pruning'
      });
      expect(getTask(sanitation.body.task.id)?.category).toBe('prune');
      expect(
        (await call(postScout, planting.id, 'POST', { windowId: 'no-such-window' })).body.code
      ).toBe('UNKNOWN_WINDOW');
      m.role = 'inspector';
      expect((await call(postScout, planting.id, 'POST', { windowId: 'pink-traps' })).status).toBe(
        403
      );
    });
  });

  it('a low-input season cannot schedule from a hidden risk window', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { planting } = seedOrchard({ profile: 'farm' });
      setSetting(`season_setup.${orchardYear()}.philosophy`, 'certified-organic');
      const r = await call(postScout, planting.id, 'POST', { windowId: 'pink-diseases' });
      expect(r.body.code).toBe('UNKNOWN_WINDOW');
    });
  });

  it('the Area summary lists its tree fruit plantings', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { area, planting } = seedOrchard({ profile: 'farm' });
      const r = await call(getArea, area.id, 'GET');
      expect(r.status).toBe(200);
      expect(r.body.plantings.map((p: { cropId: string }) => p.cropId)).toEqual([planting.id]);
    });
  });
});
