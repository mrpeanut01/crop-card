// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const auth = vi.hoisted(() => ({ role: 'owner' }));

vi.mock('$lib/server/auth', () => ({
  currentUser: () => ({ id: 'placement-user', role: auth.role }),
  requireOwner: () => {
    if (auth.role !== 'owner') throw error(403, 'owner role required');
    return { id: 'placement-user', role: 'owner' };
  }
}));

import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import {
  createPlanned,
  createPlantingGroup,
  getCrop,
  listGroupMembers,
  setSchedule
} from '$lib/db/crops';
import { listTasks } from '$lib/db/tasks';
import type { PluginRegistry } from '$lib/plugins';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getRegistry } from '$lib/server/registry';
import { PATCH as patchCrop } from '../../../routes/api/crops/[id]/+server';
import { POST as postPlanting } from '../../../routes/api/blocks/[id]/plantings/+server';
import {
  createPlacedPlantings,
  cropLookupFrom,
  writeFootprint,
  type CropLookup
} from './placement';

const LETTUCE = 'lettuce-black-seeded-simpson';
const DAY = 86_400_000;
const APR_1 = Date.UTC(2027, 3, 1);

let registry: PluginRegistry;
let lookup: CropLookup;

beforeAll(async () => {
  registry = await getRegistry();
  lookup = cropLookupFrom(registry);
}, 60_000);

function seedOwner(): string {
  const id = `placement-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedGarden() {
  const garden = createField({ name: 'Kitchen Garden', kind: 'garden', widthFt: 20, lengthFt: 30 });
  const bed = (name: string, extra: Record<string, unknown> = {}) =>
    createBlock({
      name,
      fieldId: garden.id,
      kind: 'bed',
      widthFt: 4,
      lengthFt: 8,
      xFt: 2,
      yFt: 3,
      bedStyle: 'raised',
      ...extra
    });
  return { garden, bed1: bed('Bed 1'), bed2: bed('Bed 2', { xFt: 8 }) };
}

function planned(blockId: string, cropPluginId = LETTUCE) {
  return createPlanned({ blockId, cropPluginId, varietyDisplayName: 'Lettuce' });
}

const HALF = { x_in: 0, y_in: 0, w_in: 48, l_in: 48 };

describe('writeFootprint', () => {
  it('places a planting and counts plants from the plugin spacing', () => {
    runWithTenant(seedOwner(), () => {
      const { bed1 } = seedGarden();
      const crop = planned(bed1.id);
      const out = writeFootprint(
        crop.id,
        { blockId: bed1.id, footprint: HALF, spacingPattern: 'square' },
        lookup
      );
      if (!out.ok) throw new Error(out.body.error);
      expect(out.response.planting).toMatchObject({
        footprint: HALF,
        plantCount: 24,
        plantCountProvenance: 'data',
        spacing: { inRowIn: 8, rowIn: 12, pattern: 'square', source: 'plugin' },
        cropFamily: 'leafy-green'
      });
      expect(out.response.reanchored).toBeNull();
      expect(getCrop(crop.id)).toMatchObject({
        footprint: HALF,
        spacingPattern: 'square',
        plantCount: 24,
        plantCountProvenance: 'data'
      });
      expect(getCrop(crop.id)?.spacingIn).toBeUndefined();
    });
  });

  it('stores typed spacing and typed counts as manual', () => {
    runWithTenant(seedOwner(), () => {
      const { bed1 } = seedGarden();
      const crop = planned(bed1.id);
      const spaced = writeFootprint(
        crop.id,
        {
          blockId: bed1.id,
          footprint: HALF,
          spacingPattern: 'square',
          spacingIn: 12,
          rowSpacingIn: 12
        },
        lookup
      );
      expect(spaced.ok && spaced.response.planting).toMatchObject({
        plantCount: 16,
        plantCountProvenance: 'manual',
        spacing: { source: 'manual' }
      });
      const typed = writeFootprint(
        crop.id,
        { blockId: bed1.id, footprint: HALF, spacingPattern: 'offset', plantCount: 30 },
        lookup
      );
      expect(typed.ok && typed.response.planting).toMatchObject({
        plantCount: 30,
        plantCountProvenance: 'manual'
      });
      const moved = writeFootprint(
        crop.id,
        {
          blockId: bed1.id,
          footprint: { ...HALF, x_in: 0, y_in: 24 },
          spacingPattern: 'offset',
          plantingDateMs: APR_1
        },
        lookup
      );
      expect(moved.ok && moved.response.planting).toMatchObject({
        plantCount: 30,
        plantCountProvenance: 'manual',
        spacing: { source: 'manual', inRowIn: 12 }
      });
      const cleared = writeFootprint(
        crop.id,
        { blockId: bed1.id, footprint: null, spacingPattern: 'square' },
        lookup
      );
      expect(cleared.ok && cleared.response.planting).toMatchObject({
        footprint: null,
        plantCount: null
      });
    });
  });

  it('refuses a spot past the bed edge', () => {
    runWithTenant(seedOwner(), () => {
      const { bed1 } = seedGarden();
      const out = writeFootprint(
        planned(bed1.id).id,
        {
          blockId: bed1.id,
          footprint: { x_in: 12, y_in: 0, w_in: 48, l_in: 12 },
          spacingPattern: 'square'
        },
        lookup
      );
      expect(out).toMatchObject({ ok: false, status: 400, body: { code: 'OUTSIDE_AREA' } });
    });
  });

  it('refuses blocks that are not sized beds in a garden or greenhouse', () => {
    runWithTenant(seedOwner(), () => {
      const field = createField({ name: 'North', kind: 'field' });
      const fieldBed = createBlock({
        name: 'Row',
        fieldId: field.id,
        kind: 'bed',
        widthFt: 4,
        lengthFt: 8
      });
      const { garden } = seedGarden();
      const unsized = createBlock({ name: 'Bed 9', fieldId: garden.id, kind: 'bed' });
      const plainBlock = createBlock({
        name: 'Blk',
        fieldId: garden.id,
        kind: 'block',
        widthFt: 4,
        lengthFt: 8
      });
      for (const target of [fieldBed, unsized, plainBlock]) {
        const out = writeFootprint(
          planned(target.id).id,
          { blockId: target.id, footprint: null, spacingPattern: 'square' },
          lookup
        );
        expect(out).toMatchObject({ ok: false, status: 409, body: { code: 'NOT_DESIGNABLE' } });
      }
    });
  });

  it("never reaches another Owner's bed or planting", () => {
    const theirs = runWithTenant(seedOwner(), () => {
      const { bed1 } = seedGarden();
      return { bedId: bed1.id, cropId: planned(bed1.id).id };
    });
    runWithTenant(seedOwner(), () => {
      const { bed1 } = seedGarden();
      const mine = planned(bed1.id);
      expect(
        writeFootprint(
          mine.id,
          { blockId: theirs.bedId, footprint: null, spacingPattern: 'square' },
          lookup
        )
      ).toMatchObject({ ok: false, status: 400, body: { code: 'FOREIGN_REF' } });
      expect(
        writeFootprint(
          theirs.cropId,
          { blockId: bed1.id, footprint: HALF, spacingPattern: 'square' },
          lookup
        )
      ).toMatchObject({ ok: false, status: 404 });
    });
  });

  it('moves planned plantings between beds but not ones in the ground', () => {
    runWithTenant(seedOwner(), () => {
      const { bed1, bed2 } = seedGarden();
      const plan = planned(bed1.id);
      const moved = writeFootprint(
        plan.id,
        { blockId: bed2.id, footprint: HALF, spacingPattern: 'square' },
        lookup
      );
      expect(moved.ok && moved.response.planting.blockId).toBe(bed2.id);

      const growing = planned(bed1.id);
      setSchedule(growing.id, { plantingDate: APR_1 });
      expect(getCrop(growing.id)?.status).toBe('active');
      const beforeItsDate = writeFootprint(
        growing.id,
        { blockId: bed2.id, footprint: HALF, spacingPattern: 'square' },
        lookup,
        APR_1 - 5 * 86_400_000
      );
      expect(beforeItsDate.ok && beforeItsDate.response.planting.blockId).toBe(bed2.id);
      const refused = writeFootprint(
        growing.id,
        { blockId: bed1.id, footprint: HALF, spacingPattern: 'square' },
        lookup,
        APR_1 + 86_400_000
      );
      expect(refused).toMatchObject({ ok: false, status: 409, body: { code: 'IN_GROUND' } });
      expect(refused.ok ? '' : refused.body.error).toBe(
        'Lettuce is already in the ground in Bed 2. Record a new planting instead.'
      );
    });
  });

  it('warns when two plantings share space in time', () => {
    runWithTenant(seedOwner(), () => {
      const { bed1 } = seedGarden();
      const a = createPlanned({
        blockId: bed1.id,
        cropPluginId: LETTUCE,
        varietyDisplayName: 'Early lettuce',
        plantingDate: APR_1,
        placement: {
          footprint: HALF,
          spacingIn: null,
          rowSpacingIn: null,
          spacingPattern: 'square',
          plantCount: 24,
          plantCountProvenance: 'data'
        }
      });
      const b = planned(bed1.id);
      const out = writeFootprint(
        b.id,
        {
          blockId: bed1.id,
          footprint: { x_in: 0, y_in: 24, w_in: 48, l_in: 48 },
          spacingPattern: 'square',
          plantingDateMs: APR_1 + 7 * DAY
        },
        lookup
      );
      expect(out.ok && out.response.warnings).toEqual([
        expect.stringMatching(/^Shares space with Early lettuce until [A-Z][a-z]{2} \d{1,2}\.$/)
      ]);
      expect(getCrop(a.id)?.plantCount).toBe(24);
      expect(getCrop(b.id)).toMatchObject({ plantingDate: APR_1 + 7 * DAY, status: 'planned' });
    });
  });

  it('moves a succession anchor date, its members and their tasks together', () => {
    runWithTenant(seedOwner(), () => {
      const { bed1 } = seedGarden();
      const plugin = registry.get(LETTUCE)!.plugin as CropPlugin;
      const group = createPlantingGroup({
        blockId: bed1.id,
        anchor: {
          cropPluginId: LETTUCE,
          varietyDisplayName: 'Lettuce',
          placement: {
            footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 24 },
            spacingIn: null,
            rowSpacingIn: null,
            spacingPattern: 'square',
            plantCount: 8,
            plantCountProvenance: 'data'
          }
        },
        companions: [{ cropPluginId: LETTUCE, varietyDisplayName: 'Lettuce', offsetDays: 14 }],
        anchorPlantingDateMs: APR_1,
        systemKind: 'succession',
        resolvePlugin: (id) => (id === LETTUCE ? plugin : undefined)
      });
      const [anchor, member] = group.members.map((mm) => mm.crop);
      expect(anchor.footprint).toEqual({ x_in: 0, y_in: 0, w_in: 48, l_in: 24 });
      const taskDates = () =>
        listTasks({ cropId: member.id })
          .map((t) => t.scheduledFor)
          .sort();
      const before = taskDates();

      const out = writeFootprint(
        anchor.id,
        {
          blockId: bed1.id,
          footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 24 },
          spacingPattern: 'square',
          plantingDateMs: APR_1 + 7 * DAY
        },
        lookup
      );
      if (!out.ok) throw new Error(out.body.error);
      expect(out.response.reanchored?.shifted).toBeGreaterThan(0);
      const members = listGroupMembers(group.groupId);
      expect(members.map((c) => c.plantingDate)).toEqual([APR_1 + 7 * DAY, APR_1 + 21 * DAY]);
      expect(taskDates()).toEqual(before.map((t) => t + 7 * DAY));
    });
  });

  it('moves a linked sowing to another bed, keeps its link and refuses a taken spot', () => {
    runWithTenant(seedOwner(), () => {
      const { bed1, bed2 } = seedGarden();
      const plugin = registry.get(LETTUCE)!.plugin as CropPlugin;
      const strip = (y_in: number) => ({
        footprint: { x_in: 0, y_in, w_in: 48, l_in: 24 },
        spacingIn: null,
        rowSpacingIn: null,
        spacingPattern: 'square' as const,
        plantCount: null,
        plantCountProvenance: null
      });
      const group = createPlantingGroup({
        blockId: bed1.id,
        anchor: { cropPluginId: LETTUCE, varietyDisplayName: 'Lettuce', placement: strip(0) },
        companions: [
          {
            cropPluginId: LETTUCE,
            varietyDisplayName: 'Lettuce',
            offsetDays: 14,
            placement: strip(24)
          }
        ],
        anchorPlantingDateMs: APR_1,
        systemKind: 'succession',
        resolvePlugin: (id) => (id === LETTUCE ? plugin : undefined)
      });
      const [anchor, member] = group.members.map((mm) => mm.crop);
      const blocker = createPlanned({
        blockId: bed2.id,
        cropPluginId: LETTUCE,
        varietyDisplayName: 'Early lettuce',
        plantingDate: APR_1,
        placement: strip(0)
      });

      const taken = writeFootprint(
        member.id,
        {
          blockId: bed2.id,
          footprint: { x_in: 0, y_in: 12, w_in: 48, l_in: 24 },
          spacingPattern: 'square'
        },
        lookup,
        APR_1 - DAY
      );
      expect(taken).toMatchObject({ ok: false, status: 409, body: { code: 'OVERLAP' } });
      expect(taken.ok ? '' : taken.body.error).toMatch(
        /^No room for Lettuce there in Bed 2 on Apr 15\. Early lettuce holds that spot until [A-Z][a-z]{2} \d{1,2}\.$/
      );
      expect(getCrop(member.id)?.blockId).toBe(bed1.id);

      const edge = writeFootprint(
        member.id,
        {
          blockId: bed2.id,
          footprint: { x_in: 0, y_in: 84, w_in: 48, l_in: 24 },
          spacingPattern: 'square'
        },
        lookup,
        APR_1 - DAY
      );
      expect(edge).toMatchObject({ ok: false, body: { code: 'OUTSIDE_AREA' } });

      const moved = writeFootprint(
        member.id,
        {
          blockId: bed2.id,
          footprint: { x_in: 0, y_in: 48, w_in: 48, l_in: 24 },
          spacingPattern: 'square'
        },
        lookup,
        APR_1 - DAY
      );
      if (!moved.ok) throw new Error(moved.body.error);
      expect(moved.response.planting).toMatchObject({
        blockId: bed2.id,
        groupId: group.groupId,
        groupSystemKind: 'succession'
      });
      expect(listGroupMembers(group.groupId).map((c) => c.id)).toEqual([anchor.id, member.id]);

      const later = writeFootprint(
        anchor.id,
        {
          blockId: bed1.id,
          footprint: strip(0).footprint,
          spacingPattern: 'square',
          plantingDateMs: APR_1 + 7 * DAY
        },
        lookup,
        APR_1 - DAY
      );
      if (!later.ok) throw new Error(later.body.error);
      expect(getCrop(member.id)).toMatchObject({
        blockId: bed2.id,
        plantingDate: APR_1 + 21 * DAY
      });

      setSchedule(blocker.id, { plantingDate: APR_1 });
      const inGround = writeFootprint(
        blocker.id,
        { blockId: bed1.id, footprint: strip(72).footprint, spacingPattern: 'square' },
        lookup,
        APR_1 + DAY
      );
      expect(inGround).toMatchObject({ ok: false, body: { code: 'IN_GROUND' } });
    });
  });

  it('lets a hand-placed planting share space in another bed, with a warning', () => {
    runWithTenant(seedOwner(), () => {
      const { bed1, bed2 } = seedGarden();
      createPlanned({
        blockId: bed2.id,
        cropPluginId: LETTUCE,
        varietyDisplayName: 'Early lettuce',
        plantingDate: APR_1,
        placement: {
          footprint: HALF,
          spacingIn: null,
          rowSpacingIn: null,
          spacingPattern: 'square',
          plantCount: null,
          plantCountProvenance: null
        }
      });
      const loose = createPlanned({
        blockId: bed1.id,
        cropPluginId: LETTUCE,
        varietyDisplayName: 'Lettuce',
        plantingDate: APR_1
      });
      const out = writeFootprint(
        loose.id,
        { blockId: bed2.id, footprint: HALF, spacingPattern: 'square' },
        lookup,
        APR_1 - DAY
      );
      if (!out.ok) throw new Error(out.body.error);
      expect(out.response.warnings).toHaveLength(1);
    });
  });
});

describe('createPlacedPlantings', () => {
  it('checks every item before writing any', () => {
    runWithTenant(seedOwner(), () => {
      const { bed1 } = seedGarden();
      const item = {
        blockId: bed1.id,
        cropPluginId: LETTUCE,
        varietyDisplayName: 'Lettuce',
        plantingDateMs: APR_1,
        footprint: HALF,
        spacingPattern: 'square' as const,
        source: 'fallback' as const
      };
      const bad = createPlacedPlantings(
        [item, { ...item, footprint: { x_in: 0, y_in: 90, w_in: 48, l_in: 12 } }],
        lookup
      );
      expect(bad).toMatchObject({ ok: false, body: { code: 'OUTSIDE_AREA' } });
      const good = createPlacedPlantings([item, { ...item, cropPluginId: 'moon-melon' }], lookup);
      expect(good).toMatchObject({ ok: false, status: 400 });
      const ok = createPlacedPlantings([item], lookup);
      expect(ok.ok && ok.plantings[0]).toMatchObject({
        status: 'planned',
        plantingDateMs: APR_1,
        plantCount: 24,
        plantCountProvenance: 'data'
      });
      const saved = ok.ok ? getCrop(ok.plantings[0].cropId) : undefined;
      expect(saved?.footprint).toEqual(HALF);
    });
  });
});

function jsonRequest(method: string, url: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('PATCH /api/crops/[id] set-placement', () => {
  const patch = (id: string, body: unknown) =>
    patchCrop({
      params: { id },
      request: jsonRequest('PATCH', `http://localhost/api/crops/${id}`, body)
    } as never);

  it('lets the owner place a planting and refuses a helper', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const { bed1 } = seedGarden();
      const crop = planned(bed1.id);
      const body = {
        action: 'set-placement',
        blockId: bed1.id,
        footprint: HALF,
        spacingPattern: 'square'
      };
      auth.role = 'helper';
      const refused = await patch(crop.id, body);
      expect(refused.status).toBe(403);
      expect(getCrop(crop.id)?.footprint).toBeUndefined();
      auth.role = 'owner';
      const res = await patch(crop.id, body);
      expect(res.status).toBe(200);
      expect((await res.json()).planting).toMatchObject({ footprint: HALF, plantCount: 24 });
      const bad = await patch(crop.id, {
        ...body,
        footprint: { x_in: 0, y_in: 0, w_in: 0, l_in: 1 }
      });
      expect(bad.status).toBe(400);
      const outside = await patch(crop.id, {
        ...body,
        footprint: { x_in: 0, y_in: 0, w_in: 60, l_in: 12 }
      });
      expect(outside.status).toBe(400);
      expect(await outside.json()).toMatchObject({ code: 'OUTSIDE_AREA' });
    });
  });
});

describe('POST /api/blocks/[id]/plantings with a footprint', () => {
  const post = (id: string, body: unknown) =>
    postPlanting({
      params: { id },
      request: jsonRequest('POST', `http://localhost/api/blocks/${id}/plantings`, body)
    } as never);

  it('creates a placed planting and never merges it into another', async () => {
    auth.role = 'owner';
    await runWithTenant(seedOwner(), async () => {
      const { bed1 } = seedGarden();
      const body = {
        cropPluginId: LETTUCE,
        quantityPlanted: 10,
        quantityUnit: 'plants',
        footprint: HALF,
        spacingPattern: 'square'
      };
      const first = await post(bed1.id, body);
      expect(first.status).toBe(201);
      const firstJson = await first.json();
      expect(firstJson.placed).toMatchObject({ footprint: HALF, plantCount: 24 });
      const second = await (await post(bed1.id, body)).json();
      expect(second.planting.id).not.toBe(firstJson.planting.id);

      const outside = await post(bed1.id, {
        ...body,
        footprint: { x_in: 0, y_in: 90, w_in: 48, l_in: 12 }
      });
      expect(outside.status).toBe(400);
      const plain = await (await post(bed1.id, { cropPluginId: LETTUCE })).json();
      expect(plain.placed).toBeUndefined();
    });
  });

  it('refuses a footprint on a block outside a garden', async () => {
    auth.role = 'owner';
    await runWithTenant(seedOwner(), async () => {
      const field = createField({ name: 'North', kind: 'field' });
      const block = createBlock({ name: 'North 1', fieldId: field.id, acres: 1 });
      const res = await post(block.id, { cropPluginId: LETTUCE, footprint: HALF });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'NOT_DESIGNABLE' });
    });
  });
});
