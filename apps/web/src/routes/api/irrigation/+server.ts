/**
 * POST /api/irrigation: log a watering (Phase 32E, E4-13). Owners and helpers;
 * inspectors are read-only. Safe to replay from the offline queue with the
 * client record id header. No lock, not a compliance record, never gated by
 * the season close-out.
 *
 * GET /api/irrigation?fieldId&from&to: the active Owner's watering logs.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getBlock } from '$lib/db/blocks';
import { insertIrrigationEvent, listIrrigationEvents } from '$lib/db/irrigation';
import { irrigationCreateSchema } from '$lib/irrigation/apiSchemas';
import { requireMutator, requireUser } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { assertField, rejectForeignRefs } from '$lib/server/foreignRefs';
import { checkWhen, invalid, readJson } from '$lib/server/irrigationApi';
import { writeRecord } from '$lib/server/recordWrite';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

export const _requestSchema = irrigationCreateSchema;

export const POST: RequestHandler = withClientRecordId(async (event) => {
  const user = requireMutator(event);
  const read = await readJson(event.request);
  if (!read.ok) return json({ error: 'invalid JSON body' }, { status: 400 });
  const parsed = irrigationCreateSchema.safeParse(read.body);
  if (!parsed.success) return invalid(parsed.error);
  const b = parsed.data;

  const foreign = rejectForeignRefs(assertField('fieldId', b.fieldId), [
    'blockId',
    b.blockId,
    getBlock
  ]);
  if (foreign) return foreign;
  if (b.blockId && getBlock(b.blockId)?.fieldId !== b.fieldId) {
    return json({ error: 'That bed is not in this Area.' }, { status: 400 });
  }

  const now = Date.now();
  const occurredAt = Math.min(b.occurredAt ?? now, now);
  const when = checkWhen(b.occurredAt ?? now, now, 'watering');
  if (when) return when;

  const clientRecordId = event.request.headers.get(CLIENT_RECORD_HEADER);
  const saved = writeRecord(event, () =>
    insertIrrigationEvent({
      fieldId: b.fieldId,
      blockId: b.blockId ?? null,
      occurredAt,
      durationMin: b.durationMin ?? null,
      inches: b.inches ?? null,
      gallons: b.gallons ?? null,
      method: b.method ?? null,
      notes: b.notes?.trim() || null,
      performedById: user.id,
      clientRecordId: clientRecordId && clientRecordId.length <= 80 ? clientRecordId : null
    })
  );
  return json({ irrigation: saved }, { status: 201 });
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
    return json({ error: 'from and to are epoch milliseconds' }, { status: 400 });
  }
  const fieldId = q.get('fieldId');
  const events = listIrrigationEvents({
    fieldIds: fieldId ? [fieldId] : undefined,
    fromMs: from,
    toMs: to,
    limit: 500
  });
  return json({ irrigation: events });
};
