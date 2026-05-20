/**
 * GET   /api/crops/:id  — fetch one crop with summary counts.
 * PATCH /api/crops/:id  — { action: 'mark-harvested' | 'archive' | 'mark-failed' | 'reactivate' }
 *
 * Status transitions stamp `harvested_at` / `archived_at` automatically.
 * Inspector role is read-only at the hooks layer.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteCropCascade } from '$lib/db/admin';
import {
  getCrop,
  isGroupAnchorWithMembers,
  setSchedule,
  splitCrop,
  unscheduleCrop,
  updateDetails,
  updateStatus
} from '$lib/db/crops';
import { reanchorPluginPrePost } from '$lib/db/tasks';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.enum(['mark-harvested', 'archive', 'mark-failed', 'reactivate']),
    occurredAt: z.number().int().optional()
  }),
  z.object({
    action: z.literal('set-schedule'),
    /** ms epoch; null clears (returning to "to schedule" tray). */
    plantingDate: z.number().int().nullable(),
    /** Optional move between blocks. */
    blockId: z.string().min(1).optional()
  }),
  z.object({
    /** Phase 15: change the crop plugin tied to a planting. Rejected when
     *  the row is the anchor of a multi-member group — the operator must
     *  disband the group first to avoid orphaning companion offsets. */
    action: z.literal('change-plugin'),
    cropPluginId: z.string().min(1),
    varietyDisplayName: z.string().min(1).max(160).optional()
  }),
  z.object({
    /** Phase 15c: edit operator-visible details (variety name + quantity).
     *  Plugin id is NOT editable here. */
    action: z.literal('edit-details'),
    varietyDisplayName: z.string().min(1).max(160).optional(),
    quantityPlanted: z.number().nonnegative().nullable().optional(),
    quantityUnit: z.string().min(1).max(16).nullable().optional()
  }),
  z.object({
    /** Phase 15d: pull a single crop OFF the schedule without deleting the
     *  crop row. Cascade-deletes its materialized tasks, disbands its group
     *  (if any), nulls plantingDate, flips status to 'planned'. */
    action: z.literal('unschedule')
  }),
  z.object({
    /** Phase 21b follow-up: split a crop into N stacked parts on the same
     *  date / block. Seeds + plants distributed via largest-remainder
     *  rounding. Caller is expected to drag the resulting bars to their
     *  target dates afterwards. */
    action: z.literal('split'),
    parts: z.number().int().min(2).max(12)
  })
]);

const ACTION_TO_STATUS = {
  'mark-harvested': 'harvested',
  archive: 'archived',
  'mark-failed': 'failed',
  reactivate: 'active'
} as const;

export const GET: RequestHandler = ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  const c = getCrop(params.id);
  if (!c) throw error(404, 'crop not found');
  return json({ crop: c });
};

export const PATCH: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  if (parsed.data.action === 'unschedule') {
    if (!getCrop(event.params.id)) throw error(404, 'crop not found');
    const result = unscheduleCrop(event.params.id);
    return json({ ok: true, ...result });
  }

  if (parsed.data.action === 'split') {
    if (!getCrop(event.params.id)) throw error(404, 'crop not found');
    try {
      const out = splitCrop(event.params.id, parsed.data.parts);
      return json({ crops: out });
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : 'split failed' },
        { status: 409 }
      );
    }
  }

  if (parsed.data.action === 'edit-details') {
    if (!getCrop(event.params.id)) throw error(404, 'crop not found');
    const updated = updateDetails(event.params.id, {
      varietyDisplayName: parsed.data.varietyDisplayName,
      quantityPlanted: parsed.data.quantityPlanted ?? undefined,
      quantityUnit: parsed.data.quantityUnit ?? undefined
    });
    return json({ crop: updated });
  }

  if (parsed.data.action === 'change-plugin') {
    if (isGroupAnchorWithMembers(event.params.id)) {
      return json(
        {
          error:
            'Cannot swap plugin on a group anchor. Disband the group first so companion offsets stay coherent.'
        },
        { status: 409 }
      );
    }
    return json({ error: 'change-plugin not yet implemented' }, { status: 501 });
  }

  if (parsed.data.action === 'set-schedule') {
    const before = getCrop(event.params.id);
    if (!before) throw error(404, 'crop not found');
    const result = setSchedule(event.params.id, {
      plantingDate: parsed.data.plantingDate,
      blockId: parsed.data.blockId
    });
    // Hybrid drift policy: when an active crop's planting date moves,
    // re-anchor any linked tasks (overridden ones get staleAnchor instead).
    const oldMs = before.plantingDate;
    const newMs = parsed.data.plantingDate;
    if (oldMs != null && newMs != null && oldMs !== newMs) {
      // Find primary tasks for this crop and re-anchor their pre/post.
      // For now we cover the case where the crop's primary tasks share the
      // planting date as their `scheduledFor`; the helper is idempotent.
      reanchorPluginPrePost(event.params.id, oldMs, newMs);
    }
    return json({ crop: result });
  }

  const status = ACTION_TO_STATUS[parsed.data.action];
  const updated = updateStatus(event.params.id, status, parsed.data.occurredAt);
  return json({ crop: updated });
};

/**
 * DELETE /api/crops/:id
 *
 * Hard delete with full cascade through all events tied to this crop:
 * spray / insecticide / harvest / hay cutting / fertility application,
 * plus any tasks (and their pre/post-tasks) and any stock_movements
 * pointing at the deleted events.
 */
export const DELETE: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  const c = getCrop(event.params.id);
  if (!c) throw error(404, 'crop not found');
  return json(deleteCropCascade(event.params.id));
};
