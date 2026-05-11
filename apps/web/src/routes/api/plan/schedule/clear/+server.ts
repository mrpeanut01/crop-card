/**
 * POST /api/plan/schedule/clear
 *
 * Phase 15d — Reset Schedule. Nulls plantingDate + clears group bindings on
 * every active/planned crop, cascade-deleting their materialized tasks, and
 * flips status back to 'planned' so they show up as drafts again. Crops
 * stay attached to their blocks; harvested / archived / failed rows are
 * untouched.
 *
 * Optional `blockIds` body filter restricts clearing to those blocks (used
 * by the Schedule tab's field/block filter so reset only touches visible
 * blocks).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { clearSchedule } from '$lib/db/crops';
import { requireOwner } from '$lib/server/auth';

const bodySchema = z.object({
  blockIds: z.array(z.string().min(1)).max(200).optional()
});

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  let raw: unknown = {};
  try {
    raw = await event.request.json();
  } catch {
    raw = {};
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const filter =
    parsed.data.blockIds && parsed.data.blockIds.length > 0
      ? new Set(parsed.data.blockIds)
      : null;
  const result = clearSchedule(filter);
  return json(result);
};
