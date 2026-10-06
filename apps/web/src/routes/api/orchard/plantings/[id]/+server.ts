/**
 * GET /api/orchard/plantings/[id]
 *
 * The orchard calendar summary for one planting (#562): which guide and
 * why, whether the crop has a calendar, and the block's stage mark for this
 * year. For the short panels on the Planting Card page; the full calendar
 * is the `/plan/orchard/[cropId]` page. Every role may read it.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { requireUser } from '$lib/server/auth';
import { orchardSummary } from '$lib/server/orchardApi';
import { loadOrchardPlantingView } from '$lib/server/orchardCalendar.server';

export const GET: RequestHandler = async (event) => {
  requireUser(event);
  const view = await loadOrchardPlantingView(event.params.id ?? '', {
    locale: event.locals?.locale
  });
  if (!view)
    return json({ error: t(event.locals?.locale, 'orchardui.err.notFound') }, { status: 404 });
  return json(orchardSummary(view));
};
