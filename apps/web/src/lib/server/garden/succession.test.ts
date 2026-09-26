// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const auth = vi.hoisted(() => ({ role: 'owner' }));

vi.mock('$lib/server/auth', () => ({
  currentUser: () => ({ id: 'succession-user', role: auth.role }),
  requireOwner: () => {
    if (auth.role !== 'owner') throw error(403, 'owner role required');
    return { id: 'succession-user', role: 'owner' };
  }
}));

import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned, getCrop, listCrops, listGroupMembers, setSchedule } from '$lib/db/crops';
import { createTask, listTasks } from '$lib/db/tasks';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getRegistry } from '$lib/server/registry';
import { POST as postSuccession } from '../../../routes/api/garden/beds/[blockId]/succession/+server';
import { addSuccession } from './succession';

const LETTUCE = 'lettuce-black-seeded-simpson';
const TOMATO = 'tomato-cherokee-purple';
const MAR_15 = Date.UTC(2027, 2, 15);
const SECTION = { x_in: 0, y_in: 0, w_in: 36, l_in: 180 };

let crops: Record<string, CropPlugin>;

beforeAll(async () => {
  const registry = await getRegistry();
  crops = {};
  for (const c of registry.crops()) crops[c.pluginId] = c;
}, 60_000);

function seedOwner(): string {
  const id = `succession-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedTunnel() {
  const tunnel = createField({ name: 'Tunnel', kind: 'greenhouse', widthFt: 30, lengthFt: 96 });
  return createBlock({
    name: 'Bed 1',
    fieldId: tunnel.id,
    kind: 'bed',
    widthFt: 3,
    lengthFt: 90,
    xFt: 2,
    yFt: 3,
    bedStyle: 'in-ground'
  });
}

function anchorIn(blockId: string, cropPluginId = LETTUCE) {
  return createPlanned({
    blockId,
    cropPluginId,
    varietyDisplayName: 'Salanova',
    plantingDate: MAR_15,
    placement: {
      footprint: SECTION,
      spacingIn: null,
      rowSpacingIn: null,
      spacingPattern: 'square',
      plantCount: null,
      plantCountProvenance: null
    }
  });
}

function plantTasks(cropId: string) {
  return listTasks({ cropId, kind: 'primary' }).filter(
    (t) => !t.pluginTemplateKey?.startsWith('companion-check:')
  );
}

describe('addSuccession', () => {
  it('previews without writing', () => {
    runWithTenant(seedOwner(), () => {
      const bed = seedTunnel();
      const anchor = anchorIn(bed.id);
      const out = addSuccession(bed.id, { cropId: anchor.id, count: 3, commit: false }, crops);
      if (!out.ok) throw new Error(out.body.error);
      expect(out.response.groupId).toBeNull();
      expect(out.response.proposal.sowings).toHaveLength(3);
      expect(listCrops({ blockId: bed.id })).toHaveLength(1);
    });
  });

  it('commits the sowings that fit as one succession group in free sections', () => {
    runWithTenant(seedOwner(), () => {
      const bed = seedTunnel();
      const anchor = anchorIn(bed.id);
      const out = addSuccession(bed.id, { cropId: anchor.id, count: 3, commit: true }, crops);
      if (!out.ok) throw new Error(out.body.error);
      const { groupId, created, anchor: saved } = out.response;
      expect(groupId).toBeTruthy();
      expect(created).toHaveLength(3);
      expect(saved?.groupId).toBe(groupId);
      const members = listGroupMembers(groupId!);
      expect(members).toHaveLength(4);
      expect(members.every((m) => m.groupSystemKind === 'succession')).toBe(true);
      const dates = created.map((c) => c.plantingDateMs);
      expect(dates).toEqual([...dates].sort((a, b) => a! - b!));
      expect(dates[0]).toBeGreaterThan(MAR_15);
      for (const c of created) {
        expect(c.footprint?.w_in).toBe(36);
        expect(c.footprint?.l_in).toBe(180);
        expect(c.footprint?.y_in).not.toBe(0);
        expect(c.plantCount).toBeGreaterThan(0);
      }
      expect(plantTasks(anchor.id)).toHaveLength(1);
    });
  });

  it('keeps an in-ground anchor and its tasks as they are', () => {
    runWithTenant(seedOwner(), () => {
      const bed = seedTunnel();
      const planned = anchorIn(bed.id);
      const crop = setSchedule(planned.id, { plantingDate: MAR_15 });
      createTask({
        title: 'Plant Salanova',
        kind: 'primary',
        cropId: crop.id,
        blockId: bed.id,
        scheduledFor: MAR_15
      });
      const before = plantTasks(crop.id);
      const out = addSuccession(bed.id, { cropId: crop.id, count: 1, commit: true }, crops);
      if (!out.ok) throw new Error(out.body.error);
      expect(plantTasks(crop.id)).toHaveLength(before.length);
      expect(getCrop(crop.id)?.status).toBe(crop.status);
      expect(getCrop(crop.id)?.groupId).toBe(out.response.groupId);
    });
  });

  it('says plant once for families that are not succession-sown', () => {
    runWithTenant(seedOwner(), () => {
      const bed = seedTunnel();
      const anchor = anchorIn(bed.id, TOMATO);
      const out = addSuccession(bed.id, { cropId: anchor.id, count: 2, commit: true }, crops);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.body.error).toMatch(/Plant once/);
    });
  });

  it('refuses a second group on a linked planting and another Owner’s bed', () => {
    const ownerA = seedOwner();
    let bedId = '';
    let anchorId = '';
    runWithTenant(ownerA, () => {
      const bed = seedTunnel();
      bedId = bed.id;
      anchorId = anchorIn(bed.id).id;
      const first = addSuccession(bed.id, { cropId: anchorId, count: 1, commit: true }, crops);
      expect(first.ok).toBe(true);
      const again = addSuccession(bed.id, { cropId: anchorId, count: 1, commit: true }, crops);
      expect(again.ok).toBe(false);
    });
    runWithTenant(seedOwner(), () => {
      const out = addSuccession(bedId, { cropId: anchorId, count: 1, commit: true }, crops);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.body.code).toBe('FOREIGN_REF');
    });
  });
});

describe('POST /api/garden/beds/[blockId]/succession', () => {
  it('is owner only', async () => {
    auth.role = 'helper';
    try {
      const call = postSuccession({
        params: { blockId: 'x' },
        request: new Request('http://x', {
          method: 'POST',
          body: JSON.stringify({ cropId: 'y', count: 1, commit: true })
        })
      } as unknown as Parameters<typeof postSuccession>[0]);
      await expect(call).rejects.toMatchObject({ status: 403 });
    } finally {
      auth.role = 'owner';
    }
  });

  it('rejects a bad body', async () => {
    const res = await postSuccession({
      params: { blockId: 'x' },
      request: new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ cropId: 'y', count: 9, commit: true })
      })
    } as unknown as Parameters<typeof postSuccession>[0]);
    expect(res.status).toBe(400);
  });
});
