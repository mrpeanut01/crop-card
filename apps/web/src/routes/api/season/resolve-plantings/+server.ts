/**
 * POST /api/season/resolve-plantings — mark many of a season's planned or
 * active plantings harvested, failed or archived in one go, so the close-out
 * checklist can be cleared without editing each planting (#754). Owner-only;
 * refused once the season is closed.
 */

import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireOwner } from '$lib/server/auth';
import { BULK_RESOLVE_STATUSES, bulkResolvePlantings } from '$lib/season/closeout.server';
import { SEASON_CLOSED } from '$lib/server/seasonClose';
import { t } from '$lib/i18n';

const bodySchema = z.object({
  year: z.number().int().min(2000).max(3000),
  status: z.enum(BULK_RESOLVE_STATUSES),
  cropIds: z.array(z.string().min(1)).min(1).max(5000)
});

export async function POST(event) {
  requireOwner(event);
  const raw = (await event.request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    error(400, t(event.locals?.locale, 'stockui.api.invalidRequest'));
  }
  const { year, status, cropIds } = parsed.data;
  const res = bulkResolvePlantings(year, cropIds, status);
  if (!res.ok) {
    return json(
      {
        error: SEASON_CLOSED,
        code: SEASON_CLOSED,
        year,
        message: t(event.locals?.locale, 'settings.close.bulkClosed', { year })
      },
      { status: 422 }
    );
  }
  return json({ ok: true, resolved: res.resolved.length, skipped: res.skipped.length });
}
