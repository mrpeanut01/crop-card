// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/auth', () => ({
  currentUser: () => ({ id: 'edit-xt-user', role: 'owner', impersonating: false }),
  requireOwner: () => ({ id: 'edit-xt-user', role: 'owner' })
}));

import { runWithTenant } from '$lib/db/tenant';
import { getCrop, updateDetails } from '$lib/db/crops';
import { getTask, updateTask } from '$lib/db/tasks';
import { PATCH as patchCropRoute } from '../../routes/api/crops/[id]/+server';
import { PATCH as patchTaskRoute } from '../../routes/api/tasks/[id]/+server';
import { onHandQuantity } from '$lib/db/stock';
import { POST as setQuantityRoute } from '../../routes/api/stock/[id]/set-quantity/+server';
import {
  APR_1,
  DAY,
  FP,
  patchEvent,
  postEvent,
  seedEditFarm,
  seedGardenEditFarm,
  type EditFarm,
  type GardenEditFarm
} from './editConflict.fixtures';

const SECRET_VARIETY = 'Owner B secret variety';
const SECRET_TITLE = 'Owner B secret task';
const SECRET_BODY = 'Owner B private note';

let a: EditFarm;
let b: EditFarm;
let ga: GardenEditFarm;
let gb: GardenEditFarm;

beforeAll(() => {
  a = seedEditFarm('edits-xt-a');
  b = seedEditFarm('edits-xt-b');
  ga = seedGardenEditFarm('edits-xt-ga');
  gb = seedGardenEditFarm('edits-xt-gb');
  runWithTenant(b.ownerId, () => {
    updateDetails(b.cropId, { varietyDisplayName: SECRET_VARIETY });
    updateTask(b.taskId, { title: SECRET_TITLE, body: SECRET_BODY });
  });
});

/** Runs the handler and turns a thrown SvelteKit http error into its status
 *  and text, the way the framework would. */
async function call(handler: (e: never) => unknown, event: never) {
  try {
    const res = (await handler(event)) as Response;
    return { status: res.status, text: await res.text() };
  } catch (e) {
    if (isHttpError(e)) return { status: e.status, text: JSON.stringify(e.body) };
    throw e;
  }
}

const str = fc.string({ minLength: 1, maxLength: 12 });
const plantingBody = fc.oneof(
  fc.record({
    action: fc.constant('edit-details'),
    varietyDisplayName: str,
    quantityPlanted: fc.integer({ min: 0, max: 99 }),
    base: fc.record({ varietyDisplayName: str, quantityPlanted: fc.integer({ min: 0, max: 99 }) })
  }),
  fc.record({
    action: fc.constant('set-schedule'),
    plantingDate: fc.integer({ min: 0, max: 30 }).map((d) => APR_1 + d * DAY),
    base: fc.record({ plantingDate: fc.integer({ min: 0, max: 30 }).map((d) => APR_1 + d * DAY) })
  }),
  fc.record({
    action: fc.constantFrom('mark-harvested', 'archive', 'mark-failed', 'reactivate'),
    base: fc.record({
      status: fc.constantFrom('planned', 'active', 'harvested', 'failed', 'archived')
    })
  })
);
const fpArb = fc.record({
  x_in: fc.integer({ min: 0, max: 24 }),
  y_in: fc.integer({ min: 0, max: 72 }),
  w_in: fc.constant(24),
  l_in: fc.constant(24)
});
const taskBody = fc.oneof(
  fc.record({ action: fc.constant('edit'), title: str, base: fc.record({ title: str }) }),
  fc.record({
    action: fc.constant('reschedule'),
    scheduledFor: fc.integer({ min: 0, max: 30 }).map((d) => APR_1 + d * DAY),
    base: fc.record({ scheduledFor: fc.integer({ min: 0, max: 30 }).map((d) => APR_1 + d * DAY) })
  }),
  fc.record({
    action: fc.constant('assign'),
    assigneeUserId: fc.constant(null),
    base: fc.record({ assigneeUserId: fc.option(str, { nil: null }) })
  })
);

describe('edit conflicts never leak another Owner (E-09)', () => {
  it('a PATCH with base against another Owner planting is 404, never 409', async () => {
    await fc.assert(
      fc.asyncProperty(plantingBody, async (body) => {
        const out = await runWithTenant(a.ownerId, () =>
          call(patchCropRoute as never, patchEvent('/api/crops', b.cropId, body))
        );
        expect(out.status).toBe(404);
        expect(out.text).not.toContain(SECRET_VARIETY);
        expect(out.text).not.toContain(b.blockA);
      }),
      { numRuns: 40 }
    );
  });

  it('a PATCH with base against another Owner task is 404, never 409', async () => {
    await fc.assert(
      fc.asyncProperty(taskBody, async (body) => {
        const out = await runWithTenant(a.ownerId, () =>
          call(patchTaskRoute as never, patchEvent('/api/tasks', b.taskId, body))
        );
        expect(out.status).toBe(404);
        expect(out.text).not.toContain(SECRET_TITLE);
        expect(out.text).not.toContain(SECRET_BODY);
      }),
      { numRuns: 40 }
    );
  });

  it('a set-placement with base against another Owner planting is 404, never 409', async () => {
    await fc.assert(
      fc.asyncProperty(fpArb, fpArb, async (footprint, baseFp) => {
        const body = {
          action: 'set-placement',
          blockId: ga.bed1,
          footprint,
          spacingPattern: 'square',
          base: { blockId: ga.bed1, footprint: baseFp, plantingDate: APR_1 + DAY }
        };
        const out = await runWithTenant(ga.ownerId, () =>
          call(patchCropRoute as never, patchEvent('/api/crops', gb.cropId, body))
        );
        expect(out.status).toBe(404);
        expect(out.text).not.toContain(gb.bed1);
        expect(out.text).not.toContain('x_in');
      }),
      { numRuns: 30 }
    );
  });

  it('a set-quantity with base against another Owner item is 404, never 409', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        async (quantity, onHand) => {
          const out = await runWithTenant(ga.ownerId, () =>
            call(
              setQuantityRoute as never,
              postEvent('/api/stock/:id/set-quantity', gb.stockId, {
                quantity,
                base: { onHand }
              })
            )
          );
          expect(out.status).toBe(404);
          expect(out.text).not.toContain('onHand');
        }
      ),
      { numRuns: 30 }
    );
  });

  it('leaves the other Owner rows untouched', () => {
    runWithTenant(gb.ownerId, () => {
      expect(getCrop(gb.cropId)).toMatchObject({
        blockId: gb.bed1,
        footprint: FP,
        status: 'planned'
      });
      expect(onHandQuantity(gb.stockId)).toBe(10);
    });
    runWithTenant(b.ownerId, () => {
      expect(getCrop(b.cropId)?.varietyDisplayName).toBe(SECRET_VARIETY);
      expect(getCrop(b.cropId)?.plantingDate).toBe(APR_1);
      expect(getCrop(b.cropId)?.status).toBe('active');
      expect(getTask(b.taskId)).toMatchObject({
        title: SECRET_TITLE,
        body: SECRET_BODY,
        scheduledFor: APR_1 + 3 * DAY
      });
    });
  });
});
