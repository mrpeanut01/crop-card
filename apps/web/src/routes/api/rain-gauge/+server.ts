/**
 * POST /api/rain-gauge: enter a rain-gauge reading (Phase 32E, E4-7). One
 * reading can count for several Areas; each gets its own row. A reading is
 * the rain since that Area's previous reading, or the 24 hours before it
 * when there is none in the last 7 days. Owners and helpers; replayable from
 * the offline queue; never gated by the season close-out.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { insertRainGaugeReading, previousGaugeReading } from '$lib/db/irrigation';
import { rainGaugeCreateSchema } from '$lib/irrigation/apiSchemas';
import { requireMutator } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { assertField, rejectForeignRefs } from '$lib/server/foreignRefs';
import { checkWhen, invalid, readJson } from '$lib/server/irrigationApi';
import { writeRecord } from '$lib/server/recordWrite';
import { gaugeCountsFrom } from '$lib/weather/waterBalance';
import { t } from '$lib/i18n';

export const _requestSchema = rainGaugeCreateSchema;

export const POST: RequestHandler = withClientRecordId(async (event) => {
  const user = requireMutator(event);
  const read = await readJson(event.request);
  if (!read.ok)
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  const parsed = rainGaugeCreateSchema.safeParse(read.body);
  if (!parsed.success) return invalid(parsed.error);
  const b = parsed.data;
  const fieldIds = [...new Set(b.fieldIds)];
  const foreign = rejectForeignRefs(...fieldIds.map((id) => assertField('fieldIds', id)));
  if (foreign) return foreign;

  const now = Date.now();
  const when = checkWhen(b.readAt ?? now, now, 'gauge', event.locals?.locale);
  if (when) return when;
  const readAt = Math.min(b.readAt ?? now, now);

  const readings = writeRecord(event, () =>
    fieldIds.map((fieldId) => {
      const prev = previousGaugeReading(fieldId, readAt);
      const row = insertRainGaugeReading({
        fieldId,
        readAt,
        inches: b.inches,
        recordedById: user.id
      });
      return { ...row, countsFrom: gaugeCountsFrom(prev?.readAt ?? null, readAt) };
    })
  );
  return json({ readings }, { status: 201 });
});
