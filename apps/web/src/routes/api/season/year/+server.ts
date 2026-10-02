/**
 * POST /api/season/year — choose which planting year the farm is setting
 * up. Owner-only. Body: { year }. Only the current calendar year and the
 * next one are accepted; earlier seasons are view-only.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { t } from '$lib/i18n';
import { requireOwner } from '$lib/server/auth';
import { isSelectablePlanningYear } from '$lib/season/planningYear';
import { loadPlanningYearView, setActivePlanningYear } from '$lib/season/planningYear.server';

const bodySchema = z.object({ year: z.number().int() });

export async function POST(event) {
  requireOwner(event);
  const raw = (await event.request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'invalid body');
  const now = new Date();
  if (!isSelectablePlanningYear(parsed.data.year, now)) {
    error(400, t(event.locals.locale, 'season.year.pastViewOnly'));
  }
  setActivePlanningYear(parsed.data.year, now);
  return json(loadPlanningYearView(now, event.locals.locale));
}
