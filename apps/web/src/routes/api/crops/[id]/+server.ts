/**
 * GET   /api/crops/:id  — fetch one crop with summary counts.
 * PATCH /api/crops/:id  — one of the actions in `cropPatchSchema`
 *   ($lib/crops/apiSchemas). `set-placement` places the planting in a garden
 *   bed (owner only); see lib/server/garden/placement.ts.
 *
 * Status transitions stamp `harvested_at` / `archived_at` automatically.
 * `edit-details`, `set-schedule`, `set-placement` and the status actions
 * take an optional `base` and answer 409
 * `EDIT_CONFLICT` on a stale edit (Phase 36, lib/server/editConflict.ts).
 * Inspector role is read-only at the hooks layer.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { cropHasLockedRecords, deleteCropCascade } from '$lib/db/admin';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { getBlock } from '$lib/db/blocks';
import {
  getCrop,
  isGroupAnchorWithMembers,
  setSchedule,
  splitCrop,
  unscheduleCrop,
  updateDetails,
  updateStatus
} from '$lib/db/crops';
import { reanchorCropTasks } from '$lib/db/tasks';
import { currentUser } from '$lib/server/auth';
import { rejectForeignRefsIn } from '$lib/server/foreignRefs';
import { canMutate } from '$lib/server/session';
import { t } from '$lib/i18n';
import { cropPatchSchema } from '$lib/crops/apiSchemas';
import {
  cropLookupFrom,
  failureResponse,
  gardenFailure,
  writeFootprint,
  type GardenFailure
} from '$lib/server/garden/placement';
import { getRegistry } from '$lib/server/registry';
import { db } from '$lib/db/client';
import { withClientRecordId } from '$lib/server/clientRecordId';
import {
  changedValues,
  editConflictResponse,
  plantingEditValues,
  runCheckedEdit
} from '$lib/server/editConflict';
import {
  applyPlantingEstablishment,
  localizeSeedStartNotes,
  seedStartTasksOnFirstDate
} from '$lib/server/seedStartTasks';

export const _requestSchema = cropPatchSchema;

/** Thrown inside the checked edit so a refused placement writes nothing and
 *  never marks an offline replay as saved. */
class PlacementRefused extends Error {
  constructor(readonly failure: GardenFailure) {
    super(failure.body.error);
  }
}
const patchSchema = cropPatchSchema;

const ACTION_TO_STATUS = {
  'mark-harvested': 'harvested',
  archive: 'archived',
  'mark-failed': 'failed',
  reactivate: 'active'
} as const;

export const GET: RequestHandler = ({ params, locals }) => {
  if (!params.id) throw error(400, t(locals?.locale, 'stockui.api.idRequired'));
  const c = getCrop(params.id);
  if (!c) throw error(404, t(locals?.locale, 'api.err.cropNotFound'));
  return json({ crop: c });
};

export const PATCH: RequestHandler = withClientRecordId(async (event) => {
  if (!event.params.id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.inspectorReadOnly') },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidJsonShort') },
      { status: 400 }
    );
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  if (parsed.data.action === 'set-placement') {
    if (auth?.role !== 'owner') {
      return json(
        { error: t(event.locals?.locale, 'api.err.ownerPlacesCrops'), code: 'READ_ONLY' },
        { status: 403 }
      );
    }
    const { action: _action, base, ...request } = parsed.data;
    const id = event.params.id;
    if (!getCrop(id)) {
      return failureResponse(
        gardenFailure(404, t(event.locals?.locale, 'gardenlib.place.notFound'))
      );
    }
    const lookup = cropLookupFrom(await getRegistry());
    let out;
    try {
      out = runCheckedEdit(event, {
        target: 'planting',
        id,
        action: 'set-placement',
        base,
        mine: changedValues({
          blockId: request.blockId,
          footprint: request.footprint,
          plantingDate: request.plantingDateMs
        }),
        locale: event.locals?.locale,
        read: () => getCrop(id),
        values: plantingEditValues,
        write: () => {
          const result = writeFootprint(id, request, lookup, undefined, event.locals?.locale);
          if (!result.ok) throw new PlacementRefused(result);
          return result.response;
        }
      });
    } catch (e) {
      if (e instanceof PlacementRefused) return failureResponse(e.failure);
      throw e;
    }
    if (!out.ok) {
      if (out.status === 409) return editConflictResponse(out.body);
      return failureResponse(
        gardenFailure(404, t(event.locals?.locale, 'gardenlib.place.notFound'))
      );
    }
    return json(out.value);
  }

  if (parsed.data.action === 'set-establishment') {
    if (auth?.role !== 'owner') {
      return json(
        { error: t(event.locals?.locale, 'api.err.askOwner'), code: 'READ_ONLY' },
        { status: 403 }
      );
    }
    const crop = getCrop(event.params.id);
    if (!crop) throw error(404, t(event.locals?.locale, 'api.err.cropNotFound'));
    const plugin = cropLookupFrom(await getRegistry())(crop.cropPluginId);
    const { establishment, startIndoors, sowIndoorsOn } = parsed.data;
    const id = event.params.id;
    const outcome = db.transaction(() =>
      applyPlantingEstablishment(
        id,
        {
          establishment,
          startIndoors: establishment === 'transplant' ? (startIndoors ?? true) : false,
          sowIndoorsOn
        },
        plugin
      )
    );
    return json({
      crop: getCrop(id),
      seedStart: { ...outcome, notes: localizeSeedStartNotes(outcome.notes, event.locals?.locale) }
    });
  }

  if (parsed.data.action === 'unschedule') {
    if (!getCrop(event.params.id))
      throw error(404, t(event.locals?.locale, 'api.err.cropNotFound'));
    const result = unscheduleCrop(event.params.id);
    return json({ ok: true, ...result });
  }

  if (parsed.data.action === 'split') {
    if (!getCrop(event.params.id))
      throw error(404, t(event.locals?.locale, 'api.err.cropNotFound'));
    try {
      const out = splitCrop(event.params.id, parsed.data.parts);
      return json({ crops: out });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'split failed' }, { status: 409 });
    }
  }

  if (parsed.data.action === 'edit-details') {
    const id = event.params.id;
    if (!getCrop(id)) throw error(404, t(event.locals?.locale, 'api.err.cropNotFound'));
    const patch = {
      varietyDisplayName: parsed.data.varietyDisplayName,
      quantityPlanted: parsed.data.quantityPlanted ?? undefined,
      quantityUnit: parsed.data.quantityUnit ?? undefined,
      harvestUseCases: parsed.data.harvestUseCases
    };
    const out = runCheckedEdit(event, {
      target: 'planting',
      id,
      action: 'edit-details',
      base: parsed.data.base,
      mine: changedValues(patch),
      locale: event.locals?.locale,
      read: () => getCrop(id),
      values: plantingEditValues,
      write: () => updateDetails(id, patch)
    });
    if (!out.ok) {
      if (out.status === 409) return editConflictResponse(out.body);
      throw error(404, t(event.locals?.locale, 'api.err.cropNotFound'));
    }
    return json({ crop: out.value });
  }

  if (parsed.data.action === 'change-plugin') {
    if (isGroupAnchorWithMembers(event.params.id)) {
      return json(
        {
          error: t(event.locals?.locale, 'api.err.groupAnchorSwap')
        },
        { status: 409 }
      );
    }
    return json({ error: t(event.locals?.locale, 'api.err.changePluginTodo') }, { status: 501 });
  }

  if (parsed.data.action === 'set-schedule') {
    const id = event.params.id;
    const before = getCrop(id);
    if (!before) throw error(404, t(event.locals?.locale, 'api.err.cropNotFound'));
    const foreign = rejectForeignRefsIn(event.locals?.locale, [
      'blockId',
      parsed.data.blockId,
      getBlock
    ]);
    if (foreign) return foreign;
    const plugin = cropLookupFrom(await getRegistry())(before.cropPluginId);
    const newMs = parsed.data.plantingDate;
    const blockId = parsed.data.blockId;
    const out = runCheckedEdit(event, {
      target: 'planting',
      id,
      action: 'set-schedule',
      base: parsed.data.base,
      mine: changedValues({ plantingDate: newMs, blockId: blockId || undefined }),
      locale: event.locals?.locale,
      read: () => getCrop(id),
      values: plantingEditValues,
      write: (cur) => {
        const result = setSchedule(id, { plantingDate: newMs, blockId });
        // Hybrid drift policy: when an active crop's planting date moves,
        // re-anchor every open task tied to this crop by the same delta.
        // User-overridden tasks don't move; they get `staleAnchor`.
        const oldMs = cur.plantingDate;
        if (oldMs != null && newMs != null && oldMs !== newMs) {
          reanchorCropTasks(id, oldMs, newMs);
        }
        if (oldMs == null && newMs != null) seedStartTasksOnFirstDate(id, plugin);
        return result;
      }
    });
    if (!out.ok) {
      if (out.status === 409) return editConflictResponse(out.body);
      throw error(404, t(event.locals?.locale, 'api.err.cropNotFound'));
    }
    return json({ crop: out.value });
  }

  const id = event.params.id;
  if (!getCrop(id)) throw error(404, 'crop not found');
  const status = ACTION_TO_STATUS[parsed.data.action];
  const occurredAt = parsed.data.occurredAt;
  const out = runCheckedEdit(event, {
    target: 'planting',
    id,
    action: parsed.data.action,
    base: parsed.data.base,
    mine: { status },
    locale: event.locals?.locale,
    read: () => getCrop(id),
    values: plantingEditValues,
    write: () => updateStatus(id, status, occurredAt)
  });
  if (!out.ok) {
    if (out.status === 409) return editConflictResponse(out.body);
    throw error(404, 'crop not found');
  }
  return json({ crop: out.value });
});

/**
 * DELETE /api/crops/:id
 *
 * Hard delete with full cascade through all events tied to this crop:
 * spray / insecticide / harvest / hay cutting / fertility application,
 * plus any tasks (and their pre/post-tasks) and any stock_movements
 * pointing at the deleted events.
 */
export const DELETE: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.inspectorReadOnly') },
      { status: 403 }
    );
  }
  const c = getCrop(event.params.id);
  if (!c) throw error(404, t(event.locals?.locale, 'api.err.cropNotFound'));
  if (auth?.role !== 'owner' && cropHasLockedRecords(c.id)) {
    return json(
      { error: t(event.locals?.locale, 'crops.api.deleteLockedOwnerOnly'), code: 'RECORD_LOCKED' },
      { status: 403 }
    );
  }
  const id = event.params.id;
  const guarded = await tryGuardedHoldWrite(event, auth, () => deleteCropCascade(id));
  if (!guarded.ok) return guarded.response;
  return json(guarded.value);
};
