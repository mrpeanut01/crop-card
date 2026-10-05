// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

const auth = vi.hoisted(() => ({ role: 'owner', id: 'edit-more-user' }));
vi.mock('$lib/server/auth', async () => {
  const { error } = await import('@sveltejs/kit');
  return {
    currentUser: () => ({ id: auth.id, role: auth.role, impersonating: false }),
    requireOwner: () => {
      if (auth.role !== 'owner') throw error(403, 'owner role required');
      return { id: auth.id, role: 'owner' };
    }
  };
});

import { runWithTenant } from '$lib/db/tenant';
import { getCrop, setSchedule, updateStatus } from '$lib/db/crops';
import { onHandQuantity, setOnHandQuantity } from '$lib/db/stock';
import { PATCH as patchCropRoute } from '../../routes/api/crops/[id]/+server';
import { POST as setQuantityRoute } from '../../routes/api/stock/[id]/set-quantity/+server';
import {
  APR_1,
  DAY,
  FP,
  patchEvent,
  postEvent,
  seedEditFarm,
  seedGardenEditFarm,
  type PatchOpts
} from './editConflict.fixtures';
import { isEditConflictBody } from './conflict';

const patchCrop = (id: string, body: unknown, opts?: PatchOpts) =>
  patchCropRoute(patchEvent('/api/crops', id, body, opts)) as Promise<Response>;
const setQuantity = (id: string, body: unknown, opts?: PatchOpts) =>
  setQuantityRoute(postEvent('/api/stock/:id/set-quantity', id, body, opts)) as Promise<Response>;

describe('PATCH /api/crops/:id status actions with base', () => {
  it('saves when the status is as the device saw it', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      const res = await patchCrop(farm.cropId, {
        action: 'mark-harvested',
        base: { status: 'active' }
      });
      expect(res.status).toBe(200);
      expect(getCrop(farm.cropId)?.status).toBe('harvested');
    });
  });

  it('refuses a status change when another device moved the status on', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      updateStatus(farm.cropId, 'failed');
      const res = await patchCrop(
        farm.cropId,
        { action: 'mark-harvested', base: { status: 'active' } },
        { locale: 'es' }
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(isEditConflictBody(body)).toBe(true);
      expect(body).toMatchObject({
        target: 'planting',
        action: 'mark-harvested',
        error: 'Otra persona cambió esto mientras lo editabas. No se guardó nada.',
        fields: [{ field: 'status', base: 'active', mine: 'harvested', theirs: 'failed' }]
      });
      expect(body.current.status).toBe('failed');
      const crop = getCrop(farm.cropId)!;
      expect(crop.status).toBe('failed');
      expect(crop.harvestedAt ?? null).toBeNull();
    });
  });

  it('is not a conflict when the other device made the same change', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      updateStatus(farm.cropId, 'archived');
      const res = await patchCrop(farm.cropId, { action: 'archive', base: { status: 'active' } });
      expect(res.status).toBe(200);
    });
  });

  it('keeps working without base and answers 404 for an unknown id', async () => {
    const farm = seedEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      updateStatus(farm.cropId, 'failed');
      expect((await patchCrop(farm.cropId, { action: 'reactivate' })).status).toBe(200);
      expect(getCrop(farm.cropId)?.status).toBe('active');
      await expect(patchCrop('no-such-crop', { action: 'archive' })).rejects.toMatchObject({
        status: 404
      });
    });
  });
});

describe('PATCH /api/crops/:id set-placement with base', () => {
  const place = (cropId: string, extra: Record<string, unknown>) =>
    patchCrop(cropId, { action: 'set-placement', spacingPattern: 'square', ...extra });

  it('saves when spot, bed and date are as the device saw them', async () => {
    const farm = seedGardenEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      const moved = { ...FP, x_in: 12 };
      const res = await place(farm.cropId, {
        blockId: farm.bed1,
        footprint: moved,
        base: { blockId: farm.bed1, footprint: FP, plantingDate: APR_1 }
      });
      expect(res.status).toBe(200);
      expect((await res.json()).planting.footprint).toEqual(moved);
    });
  });

  it('refuses a drag from a stale spot and leaves the other device’s move', async () => {
    const farm = seedGardenEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      const theirs = { ...FP, y_in: 24 };
      const first = await place(farm.cropId, {
        blockId: farm.bed1,
        footprint: theirs,
        base: { blockId: farm.bed1, footprint: FP }
      });
      expect(first.status).toBe(200);
      const mine = { ...FP, x_in: 24 };
      const stale = await place(farm.cropId, {
        blockId: farm.bed1,
        footprint: mine,
        base: { blockId: farm.bed1, footprint: FP, plantingDate: APR_1 }
      });
      expect(stale.status).toBe(409);
      const body = await stale.json();
      expect(isEditConflictBody(body)).toBe(true);
      expect(body.action).toBe('set-placement');
      expect(body.fields).toEqual([{ field: 'footprint', base: FP, mine, theirs }]);
      expect(body.current).toMatchObject({ blockId: farm.bed1, footprint: theirs });
      expect(getCrop(farm.cropId)?.footprint).toEqual(theirs);
    });
  });

  it('refuses a move into another bed when the date or bed changed elsewhere', async () => {
    const farm = seedGardenEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      setSchedule(farm.cropId, { plantingDate: APR_1 + 7 * DAY });
      const stale = await place(farm.cropId, {
        blockId: farm.bed2,
        footprint: FP,
        plantingDateMs: APR_1 + DAY,
        base: { blockId: farm.bed1, footprint: FP, plantingDate: APR_1 }
      });
      expect(stale.status).toBe(409);
      const body = await stale.json();
      expect(body.fields.map((f: { field: string }) => f.field)).toEqual(['plantingDate']);
      const crop = getCrop(farm.cropId)!;
      expect(crop.blockId).toBe(farm.bed1);
      expect(crop.plantingDate).toBe(APR_1 + 7 * DAY);
    });
  });

  it('keeps the placement refusals and old clients without base', async () => {
    const farm = seedGardenEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      const outside = await place(farm.cropId, {
        blockId: farm.bed1,
        footprint: { x_in: 40, y_in: 0, w_in: 24, l_in: 24 },
        base: { blockId: farm.bed1, footprint: FP }
      });
      expect(outside.status).toBe(400);
      expect((await outside.json()).code).toBe('OUTSIDE_AREA');
      const legacy = await place(farm.cropId, { blockId: farm.bed2, footprint: FP });
      expect(legacy.status).toBe(200);
      expect(getCrop(farm.cropId)?.blockId).toBe(farm.bed2);
    });
  });

  it('is owner only and answers 404 for an unknown planting', async () => {
    const farm = seedGardenEditFarm();
    await runWithTenant(farm.ownerId, async () => {
      auth.role = 'helper';
      try {
        const res = await place(farm.cropId, {
          blockId: farm.bed1,
          footprint: FP,
          base: { footprint: FP }
        });
        expect(res.status).toBe(403);
      } finally {
        auth.role = 'owner';
      }
      const gone = await place('no-such-crop', { blockId: farm.bed1, footprint: FP });
      expect(gone.status).toBe(404);
    });
  });
});

describe('POST /api/stock/:id/set-quantity with base', () => {
  const seed = () => {
    const farm = seedGardenEditFarm();
    auth.id = farm.ownerUserId;
    return farm;
  };
  it('saves when on hand is what the device showed', async () => {
    const farm = seed();
    await runWithTenant(farm.ownerId, async () => {
      const res = await setQuantity(farm.stockId, { quantity: 7, base: { onHand: 10 } });
      expect(res.status).toBe(200);
      expect((await res.json()).result).toMatchObject({ previousQuantity: 10, newQuantity: 7 });
      expect(onHandQuantity(farm.stockId)).toBe(7);
    });
  });

  it('refuses a count typed against a stale on-hand figure', async () => {
    const farm = seed();
    await runWithTenant(farm.ownerId, async () => {
      setOnHandQuantity({ stockItemId: farm.stockId, targetQuantity: 4 });
      const res = await setQuantity(farm.stockId, { quantity: 7, base: { onHand: 10 } });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(isEditConflictBody(body)).toBe(true);
      expect(body).toMatchObject({
        target: 'stock',
        id: farm.stockId,
        action: 'set-quantity',
        fields: [{ field: 'onHand', base: 10, mine: 7, theirs: 4 }],
        current: { onHand: 4 }
      });
      expect(onHandQuantity(farm.stockId)).toBe(4);
    });
  });

  it('accepts the same count from both devices and old clients without base', async () => {
    const farm = seed();
    await runWithTenant(farm.ownerId, async () => {
      setOnHandQuantity({ stockItemId: farm.stockId, targetQuantity: 7 });
      expect((await setQuantity(farm.stockId, { quantity: 7, base: { onHand: 10 } })).status).toBe(
        200
      );
      expect((await setQuantity(farm.stockId, { quantity: 2 })).status).toBe(200);
      expect(onHandQuantity(farm.stockId)).toBe(2);
    });
  });

  it('compares in hundredths and rejects a bad base', async () => {
    const farm = seed();
    await runWithTenant(farm.ownerId, async () => {
      setOnHandQuantity({ stockItemId: farm.stockId, targetQuantity: 2.5 });
      const ok = await setQuantity(farm.stockId, { quantity: 1, base: { onHand: 2.5000001 } });
      expect(ok.status).toBe(200);
      const bad = await setQuantity(farm.stockId, { quantity: 1, base: { onHand: -1 } });
      expect(bad.status).toBe(400);
    });
  });
});

describe('set-quantity over two devices (E-10)', () => {
  type CountOp = { device: 0 | 1; kind: 'refresh' } | { device: 0 | 1; kind: 'count'; q: number };
  const opArb: fc.Arbitrary<CountOp> = fc.oneof(
    fc.record({
      device: fc.constantFrom(0 as const, 1 as const),
      kind: fc.constant('refresh' as const)
    }),
    fc.record({
      device: fc.constantFrom(0 as const, 1 as const),
      kind: fc.constant('count' as const),
      q: fc.constantFrom(0, 3, 5.5, 10)
    })
  );

  it('never overwrites a count the device did not see', async () => {
    const seen = { saved: 0, refused: 0 };
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 10 }), async (ops) => {
        const farm = seedGardenEditFarm('edits-count-prop');
        auth.id = farm.ownerUserId;
        await runWithTenant(farm.ownerId, async () => {
          const views: [number, number] = [10, 10];
          for (const op of ops) {
            if (op.kind === 'refresh') {
              views[op.device] = onHandQuantity(farm.stockId);
              continue;
            }
            const before = onHandQuantity(farm.stockId);
            const base = views[op.device];
            const res = await setQuantity(farm.stockId, { quantity: op.q, base: { onHand: base } });
            const after = onHandQuantity(farm.stockId);
            if (res.status === 409) {
              seen.refused++;
              expect(after).toBe(before);
              expect(before).not.toBe(base);
              expect(before).not.toBe(op.q);
              expect((await res.json()).current).toEqual({ onHand: before });
              continue;
            }
            expect(res.status).toBe(200);
            seen.saved++;
            expect(before === base || before === op.q).toBe(true);
            expect(after).toBe(op.q);
            views[op.device] = after;
          }
        });
      }),
      { numRuns: 40 }
    );
    expect(seen.refused).toBeGreaterThan(0);
    expect(seen.saved).toBeGreaterThan(0);
  }, 120_000);
});
