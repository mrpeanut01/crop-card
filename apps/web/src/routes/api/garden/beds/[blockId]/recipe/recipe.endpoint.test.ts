// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' }));

vi.mock('$lib/server/auth', () => ({
  requireOwner: () => {
    if (m.role !== 'owner') throw error(403, 'owner role required');
    return { id: 'garden-recipe-user', role: 'owner' };
  }
}));

import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned, listCrops } from '$lib/db/crops';
import type { RecipeResponse } from '$lib/garden/api';
import { POST } from './+server';

const YEAR = 2027;

function seedOwner(): string {
  const id = `garden-recipe-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedBed(kind: 'garden' | 'field' = 'garden') {
  const area = createField({ name: 'Kitchen Garden', kind, widthFt: 20, lengthFt: 30 });
  return createBlock({
    name: 'Bed 1',
    fieldId: area.id,
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    xFt: 2,
    yFt: 3,
    bedStyle: 'raised'
  });
}

async function call(blockId: string, body: unknown): Promise<Response> {
  try {
    return await POST({
      params: { blockId },
      request: new Request(`http://localhost/api/garden/beds/${blockId}/recipe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      })
    } as never);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status) return new Response(null, { status });
    throw e;
  }
}

const recipe = (extra: Record<string, unknown> = {}) => ({
  recipePluginId: 'radishes-then-tomatoes',
  seasonYear: YEAR,
  ...extra
});

describe('POST /api/garden/beds/[blockId]/recipe', () => {
  beforeEach(() => {
    m.role = 'owner';
  });

  it('previews without writing anything', async () => {
    await runWithTenant(seedOwner(), async () => {
      const bed = seedBed();
      const res = await call(bed.id, recipe({ commit: false }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as RecipeResponse;
      expect(body.created).toEqual([]);
      expect(body.application.plantings.map((p) => p.cropPluginId)).toEqual([
        'radish-cherry-belle',
        'tomato-celebrity-f1'
      ]);
      expect(body.application.plantings.every((p) => p.provenance === 'plugin')).toBe(true);
      expect(listCrops({ blockId: bed.id })).toHaveLength(0);
    });
  });

  it('commits every step as planned plantings tagged plugin, in one go', async () => {
    await runWithTenant(seedOwner(), async () => {
      const bed = seedBed();
      const res = await call(bed.id, recipe({ commit: true }));
      expect(res.status).toBe(201);
      const body = (await res.json()) as RecipeResponse;
      expect(body.created).toHaveLength(2);
      const stored = listCrops({ blockId: bed.id });
      expect(stored).toHaveLength(2);
      for (const c of stored) {
        expect(c.status).toBe('planned');
        expect(c.sourceProvenance).toBe('plugin');
        expect(c.footprint).toEqual({ x_in: 0, y_in: 0, w_in: 48, l_in: 96 });
      }
      const byPlugin = new Map(body.application.plantings.map((p) => [p.cropPluginId, p]));
      for (const c of body.created) {
        expect(c.plantingDateMs).toBe(byPlugin.get(c.cropPluginId)?.plantingDateMs);
      }
    });
  });

  it('commits only the kept keys', async () => {
    await runWithTenant(seedOwner(), async () => {
      const bed = seedBed();
      const res = await call(bed.id, recipe({ commit: true, acceptKeys: ['s1'] }));
      expect(res.status).toBe(201);
      const stored = listCrops({ blockId: bed.id });
      expect(stored.map((c) => c.cropPluginId)).toEqual(['tomato-celebrity-f1']);
    });
  });

  it('writes nothing when a kept step no longer fits the bed as stored', async () => {
    await runWithTenant(seedOwner(), async () => {
      const bed = seedBed();
      const preview = (await (
        await call(bed.id, recipe({ commit: false }))
      ).json()) as RecipeResponse;
      const radish = preview.application.plantings.find((p) => p.key === 's0')!;
      createPlanned({
        blockId: bed.id,
        cropPluginId: 'lettuce-buttercrunch',
        varietyDisplayName: 'Lettuce',
        plantingDate: radish.plantingDateMs,
        placement: {
          footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 },
          spacingIn: null,
          rowSpacingIn: null,
          spacingPattern: 'square',
          plantCount: null,
          plantCountProvenance: null
        }
      });
      const res = await call(bed.id, recipe({ commit: true, acceptKeys: ['s0', 's1'] }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'STALE' });
      expect(listCrops({ blockId: bed.id })).toHaveLength(1);
    });
  });

  it('refuses a commit whose kept proposals came out different from the preview', async () => {
    await runWithTenant(seedOwner(), async () => {
      const bed = seedBed();
      const preview = (await (
        await call(bed.id, recipe({ commit: false }))
      ).json()) as RecipeResponse;
      const seen = preview.application.plantings.map((p) => ({
        key: p.key,
        plantingDateMs: p.plantingDateMs,
        footprint: p.footprint
      }));
      const moved = seen.map((e, i) =>
        i === 0 ? { ...e, footprint: { ...e.footprint, w_in: e.footprint.w_in - 12 } } : e
      );
      const redated = seen.map((e, i) =>
        i === 0 ? { ...e, plantingDateMs: e.plantingDateMs + 86_400_000 } : e
      );
      for (const expected of [moved, redated]) {
        const res = await call(bed.id, recipe({ commit: true, expected }));
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: 'STALE' });
      }
      expect(listCrops({ blockId: bed.id })).toHaveLength(0);

      const ok = await call(bed.id, recipe({ commit: true, expected: seen.slice(1) }));
      expect(ok.status).toBe(201);
      expect(listCrops({ blockId: bed.id })).toHaveLength(seen.length - 1);
    });
  });

  it('refuses an empty keep list, an unknown recipe and a bad body', async () => {
    await runWithTenant(seedOwner(), async () => {
      const bed = seedBed();
      expect((await call(bed.id, recipe({ commit: true, acceptKeys: [] }))).status).toBe(400);
      expect(
        (await call(bed.id, recipe({ commit: true, recipePluginId: 'no-such-recipe' }))).status
      ).toBe(404);
      expect((await call(bed.id, '{nope')).status).toBe(400);
      expect((await call(bed.id, { commit: true })).status).toBe(400);
      expect(listCrops({ blockId: bed.id })).toHaveLength(0);
    });
  });

  it('refuses a bed outside a garden and another Owner’s bed', async () => {
    const otherOwner = seedOwner();
    const other = await runWithTenant(otherOwner, async () => seedBed().id);
    await runWithTenant(seedOwner(), async () => {
      const fieldBed = seedBed('field');
      expect((await call(fieldBed.id, recipe({ commit: true }))).status).toBe(409);
      const res = await call(other, recipe({ commit: true }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'FOREIGN_REF' });
    });
    await runWithTenant(otherOwner, async () => {
      expect(listCrops({ blockId: other })).toHaveLength(0);
    });
  });

  it('refuses a helper before reading anything', async () => {
    await runWithTenant(seedOwner(), async () => {
      const bed = seedBed();
      m.role = 'helper';
      expect((await call(bed.id, recipe({ commit: true }))).status).toBe(403);
      expect(listCrops({ blockId: bed.id })).toHaveLength(0);
    });
  });
});
