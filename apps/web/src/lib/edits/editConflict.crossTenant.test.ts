// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/auth', () => ({
  currentUser: () => ({ id: 'edit-xt-user', role: 'owner', impersonating: false })
}));

import { runWithTenant } from '$lib/db/tenant';
import { getCrop, updateDetails } from '$lib/db/crops';
import { getTask, updateTask } from '$lib/db/tasks';
import { PATCH as patchCropRoute } from '../../routes/api/crops/[id]/+server';
import { PATCH as patchTaskRoute } from '../../routes/api/tasks/[id]/+server';
import { APR_1, DAY, patchEvent, seedEditFarm, type EditFarm } from './editConflict.fixtures';

const SECRET_VARIETY = 'Owner B secret variety';
const SECRET_TITLE = 'Owner B secret task';
const SECRET_BODY = 'Owner B private note';

let a: EditFarm;
let b: EditFarm;

beforeAll(() => {
  a = seedEditFarm('edits-xt-a');
  b = seedEditFarm('edits-xt-b');
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
  })
);
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

  it('leaves the other Owner rows untouched', () => {
    runWithTenant(b.ownerId, () => {
      expect(getCrop(b.cropId)?.varietyDisplayName).toBe(SECRET_VARIETY);
      expect(getCrop(b.cropId)?.plantingDate).toBe(APR_1);
      expect(getTask(b.taskId)).toMatchObject({
        title: SECRET_TITLE,
        body: SECRET_BODY,
        scheduledFor: APR_1 + 3 * DAY
      });
    });
  });
});
