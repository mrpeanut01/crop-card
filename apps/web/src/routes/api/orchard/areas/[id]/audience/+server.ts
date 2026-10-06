/**
 * PUT /api/orchard/areas/[id]/audience  { audience: 'home' | 'commercial' | null, confirmCommercial? }
 *
 * The owner's guide choice for an Area (OP-4), stored as
 * `orchard_calendar_audience.<areaId>` and shown as `manual`; null goes back
 * to automatic. Choosing commercial needs `confirmCommercial: true`, since
 * that guide is written for commercial orchards. Owner only.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { getField } from '$lib/db/fields';
import { setAudienceOverride } from '$lib/db/orchardCalendar';
import { orchardAudiencePutSchema } from '$lib/orchard/apiSchemas';
import { requireOwner } from '$lib/server/auth';
import { readBody } from '$lib/server/orchardApi';

export const _requestSchema = orchardAudiencePutSchema;

export const PUT: RequestHandler = async (event) => {
  requireOwner(event);
  const locale = event.locals?.locale;
  const body = await readBody(event, orchardAudiencePutSchema);
  if (!body.ok) return body.response;
  const area = getField(event.params.id ?? '');
  if (!area) return json({ error: t(locale, 'orchardui.err.areaNotFound') }, { status: 404 });
  const { audience, confirmCommercial } = body.data;
  if (audience === 'commercial' && confirmCommercial !== true) {
    return json(
      { error: t(locale, 'orchardui.err.confirmCommercial'), code: 'CONFIRM_COMMERCIAL' },
      { status: 400 }
    );
  }
  setAudienceOverride(area.id, audience);
  return json({ areaId: area.id, audience });
};
