// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string | null }));

vi.mock('$lib/server/auth', () => ({
  requireUser: () => {
    if (!m.role) throw error(401, 'sign in');
    return { id: 'garden-design-user', role: m.role };
  }
}));

import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import type { GardenDesignResponse } from '$lib/garden/api';
import { GET } from './+server';

function seedOwner(): string {
  const id = `garden-design-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedGarden(kind: 'garden' | 'greenhouse' | 'field' = 'garden') {
  const area = createField({ name: 'Kitchen Garden', kind, widthFt: 20, lengthFt: 30 });
  const bed = createBlock({
    name: 'Bed 1',
    fieldId: area.id,
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    xFt: 2,
    yFt: 3,
    bedStyle: 'raised'
  });
  createPlanned({
    blockId: bed.id,
    cropPluginId: 'tomato-celebrity-f1',
    varietyDisplayName: 'Tomato',
    plantingDate: Date.UTC(new Date().getFullYear(), 4, 20)
  });
  return { area, bed };
}

async function call(id: string, season?: string): Promise<Response> {
  const url = new URL(`http://localhost/api/garden/areas/${id}/design`);
  if (season) url.searchParams.set('season', season);
  try {
    return await GET({ params: { id }, url } as never);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status) return new Response(null, { status });
    throw e;
  }
}

describe('GET /api/garden/areas/[id]/design', () => {
  beforeEach(() => {
    m.role = 'owner';
  });

  it('gives the owner the design, catalog, recipes and edit rights', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { area, bed } = seedGarden();
      const res = await call(area.id);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as GardenDesignResponse;
      expect(body.canEdit).toBe(true);
      expect(body.role).toBe('owner');
      expect(body.areaKind).toBe('garden');
      expect(body.design.beds.map((b) => b.blockId)).toEqual([bed.id]);
      expect(Object.values(body.history).flat()).toHaveLength(1);
      expect(body.design.readOnly).toBe(false);
      expect(body.catalog.length).toBeGreaterThan(100);
      expect(body.recipes.length).toBeGreaterThan(0);
      expect(body.seasons).toContain(body.activeYear);
      expect(body.design.seasonYear).toBe(body.activeYear);
    });
  });

  it('is read-only for a helper and honours only a season it offers', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { area } = seedGarden('greenhouse');
      m.role = 'helper';
      const body = (await (await call(area.id, '1999')).json()) as GardenDesignResponse;
      expect(body.canEdit).toBe(false);
      expect(body.design.readOnly).toBe(true);
      expect(body.design.readOnlyReason).toBe('role');
      expect(body.design.seasonYear).toBe(body.activeYear);
      const other = body.seasons.find((y) => y !== body.activeYear);
      if (other) {
        const again = (await (await call(area.id, String(other))).json()) as GardenDesignResponse;
        expect(again.design.seasonYear).toBe(other);
      }
    });
  });

  it('is a 404 for a field, an unknown id and another Owner’s garden', async () => {
    const otherArea = await runWithTenant(seedOwner(), async () => seedGarden().area.id);
    await runWithTenant(seedOwner(), async () => {
      const { area } = seedGarden('field');
      expect((await call(area.id)).status).toBe(404);
      expect((await call('no-such-area')).status).toBe(404);
      expect((await call(otherArea)).status).toBe(404);
    });
  });

  it('refuses a request without a session', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { area } = seedGarden();
      m.role = null;
      expect((await call(area.id)).status).toBe(401);
    });
  });
});
