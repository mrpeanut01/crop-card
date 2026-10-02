/**
 * GET  /api/harvest/:id/dispositions: where this harvest went.
 * POST /api/harvest/:id/dispositions: add one (owner or helper; replayable
 * from the offline queue as `harvest-disposition`).
 *
 * Phase 33B (B2). Dispositions are not hold facts (O-13); the season
 * close-out gates the date like the harvest record itself (B-28).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { dispositionCreateSchema } from '$lib/harvest/apiSchemas';
import { dispositionDateProblem } from '$lib/harvest/dispositions';
import { getHarvestEvent } from '$lib/db/harvestEvents';
import { insertHarvestDisposition } from '$lib/db/harvestDispositions';
import { farmTimeZone, prefsFor } from '$lib/db/userProfile';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { checkSeasonClosed } from '$lib/server/seasonClose';
import { hasClientRecordId, withClientRecordId } from '$lib/server/clientRecordId';
import { writeRecord } from '$lib/server/recordWrite';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { farmHasOrganicStatus } from '$lib/harvest/organicAtHarvest.server';
import {
  dispositionNotices,
  dispositionViewsFor,
  presentDisposition,
  problem
} from '$lib/server/harvestDispositions';

export const _requestSchema = dispositionCreateSchema;

export const GET: RequestHandler = async (event) => {
  const user = currentUser(event);
  if (!user) return problem(401, 'UNAUTHENTICATED', 'Sign in to see where this harvest went.');
  const harvest = getHarvestEvent(event.params.id ?? '');
  if (!harvest) return problem(404, 'NOT_FOUND', 'No such harvest record.');
  return json({ dispositions: dispositionViewsFor([harvest.id], user.role)[harvest.id] ?? [] });
};

export const POST: RequestHandler = withClientRecordId(async (event) => {
  const user = currentUser(event);
  if (!user) return problem(401, 'UNAUTHENTICATED', 'Sign in to record where a harvest went.');
  if (!canMutate(user.role)) {
    return problem(403, 'READ_ONLY', 'Inspectors can read records but not add to them.');
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return problem(400, 'INVALID_BODY', 'The request body is not JSON.');
  }
  const parsed = dispositionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'INVALID_BODY',
        message: parsed.error.issues[0]?.message ?? 'Check the fields and try again.',
        issues: parsed.error.issues
      },
      { status: 400 }
    );
  }
  const harvest = getHarvestEvent(event.params.id ?? '');
  if (!harvest) return problem(404, 'NOT_FOUND', 'No such harvest record.');

  const now = Date.now();
  const occurredAt = parsed.data.occurredAt ?? now;
  const dated = dispositionDateProblem(occurredAt, harvest.occurredAt, farmTimeZone(), now);
  if (dated) return problem(400, dated.error, dated.message);
  const closed = checkSeasonClosed(occurredAt);
  if (closed) {
    return json(
      { error: closed.code, message: closed.message, year: closed.year },
      { status: 422 }
    );
  }

  const asked = farmHasOrganicStatus();
  const soldAsOrganic =
    parsed.data.kind === 'sold' && asked ? (parsed.data.soldAsOrganic ?? null) : null;
  const clientRecordId = hasClientRecordId(event.request)
    ? event.request.headers.get(CLIENT_RECORD_HEADER)
    : null;

  const saved = writeRecord(event, () =>
    insertHarvestDisposition(
      {
        harvestEventId: harvest.id,
        kind: parsed.data.kind,
        quantity: parsed.data.quantity,
        unit: parsed.data.unit,
        occurredAt,
        recipient: parsed.data.recipient?.trim() || null,
        soldAsOrganic
      },
      { createdBy: user.id, clientRecordId, now }
    )
  );
  const notices = dispositionNotices(harvest, saved, prefsFor(user.id));
  return json(
    { disposition: presentDisposition(saved, user.role, now), ...notices },
    { status: 201 }
  );
});
