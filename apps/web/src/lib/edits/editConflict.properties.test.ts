// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('$lib/server/auth', () => ({
  currentUser: () => ({ id: 'edit-prop-user', role: 'owner', impersonating: false })
}));

import { runWithTenant } from '$lib/db/tenant';
import { getCrop } from '$lib/db/crops';
import { getTask } from '$lib/db/tasks';
import { plantingEditValues, taskEditValues } from '$lib/server/editConflict';
import { PATCH as patchCropRoute } from '../../routes/api/crops/[id]/+server';
import { PATCH as patchTaskRoute } from '../../routes/api/tasks/[id]/+server';
import { APR_1, DAY, patchEvent, seedEditFarm, type EditFarm } from './editConflict.fixtures';
import {
  EDIT_FIELDS_BY_ACTION,
  isEditConflictBody,
  sameEditValue,
  type EditField,
  type EditValues
} from './conflict';

type Op =
  | { device: 0 | 1; kind: 'refresh' }
  | { device: 0 | 1; kind: 'edit-details'; patch: Record<string, unknown> }
  | { device: 0 | 1; kind: 'set-schedule'; plantingDate: number | null; block: 'A' | 'B' | null }
  | { device: 0 | 1; kind: 'task-edit'; patch: Record<string, unknown> }
  | { device: 0 | 1; kind: 'reschedule'; scheduledFor: number }
  | { device: 0 | 1; kind: 'assign'; who: 0 | 1 | 2 }
  | { device: 0 | 1; kind: 'status'; action: StatusAction };

type StatusAction = 'mark-harvested' | 'archive' | 'mark-failed' | 'reactivate';
const STATUS_OF: Record<StatusAction, string> = {
  'mark-harvested': 'harvested',
  archive: 'archived',
  'mark-failed': 'failed',
  reactivate: 'active'
};
/** Fields an action may change besides its own (set-schedule moves a
 *  planting between planned and active). */
const SIDE_EFFECTS: Record<string, readonly EditField[]> = {
  'planting:set-schedule': ['status']
};

const device = fc.constantFrom(0 as const, 1 as const);
const someOf = <T extends Record<string, fc.Arbitrary<unknown>>>(r: T) =>
  fc.record(r, { requiredKeys: [] }).filter((o) => Object.keys(o).length > 0);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ device, kind: fc.constant('refresh' as const) }),
  fc.record({
    device,
    kind: fc.constant('edit-details' as const),
    patch: someOf({
      varietyDisplayName: fc.constantFrom('Lettuce', 'Romaine', 'Cos', 'Butterhead'),
      quantityPlanted: fc.constantFrom(10, 12, 20),
      quantityUnit: fc.constantFrom('ft', 'plants'),
      harvestUseCases: fc.constantFrom(null, ['baby'], ['head'], ['head', 'baby'])
    })
  }),
  fc.record({
    device,
    kind: fc.constant('set-schedule' as const),
    plantingDate: fc.constantFrom(null, APR_1, APR_1 + 7 * DAY, APR_1 + 14 * DAY),
    block: fc.constantFrom('A' as const, 'B' as const, null)
  }),
  fc.record({
    device,
    kind: fc.constant('task-edit' as const),
    patch: someOf({
      title: fc.constantFrom('Weed bed A', 'Weed both', 'Hoe'),
      body: fc.constantFrom('Hand hoe', 'Wheel hoe', '')
    })
  }),
  fc.record({
    device,
    kind: fc.constant('reschedule' as const),
    scheduledFor: fc.constantFrom(APR_1 + 3 * DAY, APR_1 + 4 * DAY, APR_1 + 5 * DAY)
  }),
  fc.record({
    device,
    kind: fc.constant('assign' as const),
    who: fc.constantFrom(0 as const, 1 as const, 2 as const)
  }),
  fc.record({
    device,
    kind: fc.constant('status' as const),
    action: fc.constantFrom<StatusAction>('mark-harvested', 'archive', 'mark-failed', 'reactivate')
  })
);

interface View {
  planting: EditValues;
  task: EditValues;
}

function snapshot(farm: EditFarm): View {
  return {
    planting: plantingEditValues(getCrop(farm.cropId)!),
    task: taskEditValues(getTask(farm.taskId)!)
  };
}

function pick(values: EditValues, fields: readonly EditField[]): EditValues {
  const out: EditValues = {};
  for (const f of fields) out[f] = values[f] ?? null;
  return out;
}

async function send(farm: EditFarm, view: View, op: Exclude<Op, { kind: 'refresh' }>) {
  let target: 'planting' | 'task';
  let body: Record<string, unknown>;
  let mine: EditValues;
  if (op.kind === 'edit-details') {
    target = 'planting';
    mine = op.patch as EditValues;
    body = { action: 'edit-details', ...op.patch };
  } else if (op.kind === 'set-schedule') {
    target = 'planting';
    const blockId = op.block === 'A' ? farm.blockA : op.block === 'B' ? farm.blockB : undefined;
    mine = blockId ? { plantingDate: op.plantingDate, blockId } : { plantingDate: op.plantingDate };
    body = {
      action: 'set-schedule',
      plantingDate: op.plantingDate,
      ...(blockId ? { blockId } : {})
    };
  } else if (op.kind === 'status') {
    target = 'planting';
    mine = { status: STATUS_OF[op.action] };
    body = { action: op.action };
  } else if (op.kind === 'task-edit') {
    target = 'task';
    mine = op.patch as EditValues;
    body = { action: 'edit', ...op.patch };
  } else if (op.kind === 'reschedule') {
    target = 'task';
    mine = { scheduledFor: op.scheduledFor };
    body = { action: 'reschedule', scheduledFor: op.scheduledFor };
  } else {
    target = 'task';
    const assigneeUserId = [null, farm.helperId, farm.otherHelperId][op.who];
    mine = { assigneeUserId };
    body = { action: 'assign', assigneeUserId };
  }
  const base = pick(view[target], Object.keys(mine) as EditField[]);
  body.base = base;
  const res = (await (target === 'planting'
    ? patchCropRoute(patchEvent('/api/crops', farm.cropId, body))
    : patchTaskRoute(patchEvent('/api/tasks', farm.taskId, body)))) as Response;
  return { target, mine, base, res, action: body.action as string };
}

describe('no stale edit overwrites silently (E-10)', () => {
  it('holds over random two-device interleavings on real SQLite', async () => {
    const seen = { saved: 0, refused: 0 };
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 14 }), async (ops) => {
        const farm = seedEditFarm('edits-prop');
        await runWithTenant(farm.ownerId, async () => {
          const start = snapshot(farm);
          const views: [View, View] = [structuredClone(start), structuredClone(start)];
          for (const op of ops) {
            if (op.kind === 'refresh') {
              views[op.device] = snapshot(farm);
              continue;
            }
            const before = snapshot(farm);
            const { target, mine, base, res, action } = await send(farm, views[op.device], op);
            const after = snapshot(farm);
            const actionFields = EDIT_FIELDS_BY_ACTION[`${target}:${action}`];
            expect(actionFields).toBeDefined();
            if (res.status === 409) {
              seen.refused++;
              const body = await res.json();
              expect(isEditConflictBody(body)).toBe(true);
              expect(body.fields.length).toBeGreaterThan(0);
              expect(after).toEqual(before);
              expect(body.current).toEqual(before[target]);
              for (const f of body.fields) {
                expect(
                  sameEditValue(before[target][f.field as EditField], base[f.field as EditField])
                ).toBe(false);
                expect(
                  sameEditValue(before[target][f.field as EditField], mine[f.field as EditField])
                ).toBe(false);
              }
              continue;
            }
            expect(res.status).toBe(200);
            seen.saved++;
            const other = target === 'planting' ? 'task' : 'planting';
            expect(after[other]).toEqual(before[other]);
            for (const f of Object.keys(before[target]) as EditField[]) {
              if (f in mine) {
                const wasBase = sameEditValue(before[target][f], base[f]);
                const wasMine = sameEditValue(before[target][f], mine[f]);
                expect(wasBase || wasMine).toBe(true);
                expect(sameEditValue(after[target][f], mine[f])).toBe(true);
              } else if (!(SIDE_EFFECTS[`${target}:${action}`] ?? []).includes(f)) {
                expect(sameEditValue(after[target][f], before[target][f])).toBe(true);
              }
            }
            const json = await res.json();
            views[op.device][target] =
              target === 'planting' ? plantingEditValues(json.crop) : taskEditValues(json.task);
          }
        });
      }),
      { numRuns: 60 }
    );
    expect(seen.refused).toBeGreaterThan(0);
    expect(seen.saved).toBeGreaterThan(0);
  }, 120_000);
});
