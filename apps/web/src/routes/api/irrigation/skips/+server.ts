/**
 * POST /api/irrigation/skips: a scheduled waterer run did not water ("It
 * didn't run", "I turned it off for the rain"), so it no longer counts as
 * water given (Phase 37E). Owners and helpers; inspectors read only. Safe to
 * replay from the offline queue (`irrigation-skip`) with the client record
 * id header; the same run skipped twice answers with the first skip.
 *
 * GET /api/irrigation/skips?equipmentId&from&to: the active Owner's skips.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getEquipment } from '$lib/db/equipment';
import { findIrrigationSkip, insertIrrigationSkip, listIrrigationSkips } from '$lib/db/waterers';
import { t } from '$lib/i18n';
import { irrigationSkipSchema } from '$lib/irrigation/apiSchemas';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { requireMutator, requireUser } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { invalid, readJson } from '$lib/server/irrigationApi';
import { writeRecord } from '$lib/server/recordWrite';

export const _requestSchema = irrigationSkipSchema;

/** A skip can name a run up to a week back (the advice window) or a week
 *  ahead (turned off for rain that is coming). */
const SKIP_REACH_MS = 8 * 24 * 60 * 60 * 1000;

export const POST: RequestHandler = withClientRecordId(async (event) => {
  const user = requireMutator(event);
  const locale = event.locals?.locale;
  const read = await readJson(event.request);
  if (!read.ok) return json({ error: t(locale, 'stockui.api.invalidJson') }, { status: 400 });
  const parsed = irrigationSkipSchema.safeParse(read.body);
  if (!parsed.success) return invalid(parsed.error);
  const b = parsed.data;

  const equipment = getEquipment(b.equipmentId);
  if (!equipment) {
    return json(
      { error: t(locale, 'api.err.unknownRef', { field: 'equipmentId' }) },
      { status: 400 }
    );
  }
  if (equipment.type !== 'irrigation') {
    return json({ error: t(locale, 'herbse.api.scheduleIrrigationOnly') }, { status: 400 });
  }
  const now = Date.now();
  if (Math.abs(b.scheduledAt - now) > SKIP_REACH_MS) {
    return json(
      { error: t(locale, 'herbse.api.skipTooFar'), code: 'OUT_OF_RANGE' },
      { status: 400 }
    );
  }

  const clientRecordId = event.request.headers.get(CLIENT_RECORD_HEADER);
  const result = writeRecord(event, () => {
    const existing = findIrrigationSkip(b.equipmentId, b.scheduledAt);
    if (existing) return { skip: existing, created: false };
    const skip = insertIrrigationSkip({
      equipmentId: b.equipmentId,
      scheduledAt: b.scheduledAt,
      reason: b.reason,
      notes: b.notes?.trim() || null,
      createdBy: user.id,
      clientRecordId: clientRecordId && clientRecordId.length <= 80 ? clientRecordId : null
    });
    return { skip, created: true };
  });
  return json({ skip: result.skip }, { status: result.created ? 201 : 200 });
});

function parseMs(raw: string | null): number | undefined | null {
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const GET: RequestHandler = (event) => {
  requireUser(event);
  const q = event.url.searchParams;
  const from = parseMs(q.get('from'));
  const to = parseMs(q.get('to'));
  if (from === null || to === null) {
    return json({ error: t(event.locals?.locale, 'api.errB.fromToMs') }, { status: 400 });
  }
  const equipmentId = q.get('equipmentId');
  return json({
    skips: listIrrigationSkips({
      equipmentIds: equipmentId ? [equipmentId] : undefined,
      fromMs: from,
      toMs: to
    })
  });
};
