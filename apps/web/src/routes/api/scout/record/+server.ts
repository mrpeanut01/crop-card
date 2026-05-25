/**
 * POST /api/scout/record
 *
 * Phase 25d (#95) — standalone scout observation endpoint. Mirrors
 * /api/insecticide/record but observation-only (no kernel verdict, no
 * stock changes). Lets operators record pre-spray scouts (or
 * mid-season counts that don't trigger a spray) without folding the
 * data into an insecticide event.
 *
 * The IPM threshold gate evaluator reads from this table as its
 * primary scout-data source (via scoutLogByBlock()).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { insertScoutObservation } from '$lib/db/scoutObservations';
import { ensureSystemUser } from '$lib/db/users';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

const requestSchema = z.object({
  blockId: z.string().min(1),
  cropId: z.string().optional(),
  pest: z.string().min(1).max(80),
  metric: z.string().min(1).max(40),
  value: z.number().nonnegative(),
  notes: z.string().max(500).optional(),
  occurredAt: z.number().int().optional()
});

export const POST: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }

  const performer = auth ?? (await ensureSystemUser());
  const persisted = insertScoutObservation({
    blockId: parsed.data.blockId,
    cropId: parsed.data.cropId,
    performedById: performer.id,
    pest: parsed.data.pest,
    metric: parsed.data.metric,
    value: parsed.data.value,
    notes: parsed.data.notes,
    occurredAt: parsed.data.occurredAt ?? Date.now()
  });

  return json({ observation: persisted }, { status: 201 });
};
