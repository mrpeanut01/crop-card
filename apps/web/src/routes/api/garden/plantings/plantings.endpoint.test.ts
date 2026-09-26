// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' }));

vi.mock('$lib/server/auth', () => ({
  requireOwner: () => {
    if (m.role !== 'owner') throw error(403, 'owner role required');
    return { id: 'garden-plantings-user', role: 'owner' };
  }
}));

import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { getCrop, listCrops } from '$lib/db/crops';
import { blockHasRecords } from '$lib/db/admin';
import { writeFootprint, cropLookupFrom } from '$lib/server/garden/placement';
import { getRegistry } from '$lib/server/registry';
import type { PlantingCreateResponse } from '$lib/garden/api';
import { POST } from './+server';

const MAY_20 = Date.UTC(2027, 4, 20);

function seedOwner(): string {
  const id = `garden-plantings-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedBeds() {
  const area = createField({ name: 'Kitchen Garden', kind: 'garden', widthFt: 20, lengthFt: 30 });
  const bed = (name: string, xFt: number) =>
    createBlock({
      name,
      fieldId: area.id,
      kind: 'bed',
      widthFt: 4,
      lengthFt: 8,
      xFt,
      yFt: 3,
      bedStyle: 'raised'
    });
  return { bed1: bed('Bed 1', 2), bed2: bed('Bed 2', 8) };
}

function item(blockId: string, extra: Record<string, unknown> = {}) {
  return {
    blockId,
    cropPluginId: 'tomato-celebrity-f1',
    varietyDisplayName: 'Tomato',
    plantingDateMs: MAY_20,
    footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 24 },
    spacingPattern: 'square',
    source: 'manual',
    ...extra
  };
}

function call(plantings: unknown[]) {
  return POST({
    request: new Request('http://localhost/api/garden/plantings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plantings })
    })
  } as never);
}

describe('POST /api/garden/plantings', () => {
  beforeEach(() => {
    m.role = 'owner';
  });

  it('saves dated plantings as plans that can still move beds, and a bed of plans can go', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { bed1, bed2 } = seedBeds();
      const res = await call([item(bed1.id)]);
      expect(res.status).toBe(201);
      const { plantings } = (await res.json()) as PlantingCreateResponse;
      expect(plantings).toHaveLength(1);
      expect(plantings[0]).toMatchObject({ status: 'planned', plantingDateMs: MAY_20 });
      expect(getCrop(plantings[0].cropId)?.status).toBe('planned');
      expect(blockHasRecords(bed1.id)).toBe(false);

      const moved = writeFootprint(
        plantings[0].cropId,
        {
          blockId: bed2.id,
          footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 24 },
          spacingPattern: 'square'
        },
        cropLookupFrom(await getRegistry())
      );
      expect(moved.ok && moved.response.planting.blockId).toBe(bed2.id);
    });
  });

  it('writes nothing when any item is bad, so a retry never duplicates', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { bed1 } = seedBeds();
      const res = await call([
        item(bed1.id),
        item(bed1.id, { footprint: { x_in: 0, y_in: 0, w_in: 96, l_in: 24 } })
      ]);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'OUTSIDE_AREA' });
      expect(listCrops({ blockId: bed1.id })).toHaveLength(0);
    });
  });

  it('keeps a recipe planting tagged as plugin', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { bed1 } = seedBeds();
      const res = await call([item(bed1.id, { source: 'plugin' })]);
      const { plantings } = (await res.json()) as PlantingCreateResponse;
      expect(plantings[0].sourceProvenance).toBe('plugin');
      expect(getCrop(plantings[0].cropId)?.sourceProvenance).toBe('plugin');
    });
  });

  it('is owner only', async () => {
    m.role = 'helper';
    await expect(call([item('x')])).rejects.toMatchObject({ status: 403 });
  });
});
