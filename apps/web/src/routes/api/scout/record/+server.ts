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

import { withClientRecordId } from '$lib/server/clientRecordId';
import { writeRecord } from '$lib/server/recordWrite';
import { json, type RequestHandler } from '@sveltejs/kit';
import { scoutRecordSchema } from '$lib/records/apiSchemas';
import { getBlock } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { insertScoutObservation } from '$lib/db/scoutObservations';
import { ensureSystemUser } from '$lib/db/users';
import { currentUser } from '$lib/server/auth';
import { rejectForeignRefs } from '$lib/server/foreignRefs';
import { canMutate } from '$lib/server/session';

export const _requestSchema = scoutRecordSchema;
const requestSchema = scoutRecordSchema;

export const POST: RequestHandler = withClientRecordId(async (event) => {
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

  const foreign = rejectForeignRefs(
    ['blockId', parsed.data.blockId, getBlock],
    ['cropId', parsed.data.cropId, getCrop]
  );
  if (foreign) return foreign;

  const performer = auth ?? (await ensureSystemUser());
  const persisted = writeRecord(event, () =>
    insertScoutObservation({
      blockId: parsed.data.blockId,
      cropId: parsed.data.cropId,
      performedById: performer.id,
      pest: parsed.data.pest,
      metric: parsed.data.metric,
      value: parsed.data.value,
      notes: parsed.data.notes,
      occurredAt: parsed.data.occurredAt ?? Date.now()
    })
  );

  return json({ observation: persisted }, { status: 201 });
});
