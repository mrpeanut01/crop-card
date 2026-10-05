/**
 * PATCH /api/stock/:id/lots/:lotId/seed-sourcing (33B, B-37, B-38). The
 * owner records a seed lot's organic status, the suppliers checked and a
 * commercial unavailability note. Never gated by SEASON_CLOSED. Search
 * evidence attaches through the document link API (subject `stock-lot`).
 */

import { t } from '$lib/i18n';
import { json, type RequestHandler } from '@sveltejs/kit';
import { farmTimeZone } from '$lib/db/userProfile';
import { DEFAULT_PREFS, todayYmd } from '$lib/prefs';
import { requireOwner } from '$lib/server/auth';
import { seedSourcingPatchSchema } from '$lib/stock/apiSchemas';
import { lotOfItem, setLotSeedSourcing } from '$lib/stock/seedSourcing.server';

export const _requestSchema = seedSourcingPatchSchema;

export const PATCH: RequestHandler = async (event) => {
  const user = requireOwner(event);
  if (user.impersonating) {
    return json(
      {
        error: 'NOT_WHILE_IMPERSONATING',
        message: t(event.locals?.locale, 'stockui.api.seedImpersonating')
      },
      { status: 403 }
    );
  }
  const found = lotOfItem(event.params.id ?? '', event.params.lotId ?? '');
  if (!found) {
    return json(
      { error: 'NOT_FOUND', message: t(event.locals?.locale, 'stockui.api.seedLotNotFound') },
      { status: 404 }
    );
  }
  if (found.category !== 'seed') {
    return json(
      { error: 'NOT_SEED', message: t(event.locals?.locale, 'stockui.api.seedNotSeed') },
      { status: 400 }
    );
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json(
      { error: 'INVALID', message: t(event.locals?.locale, 'stockui.api.seedInvalidJson') },
      { status: 400 }
    );
  }
  const parsed = seedSourcingPatchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
        message: t(event.locals?.locale, 'stockui.api.seedCheckFields'),
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  const today = todayYmd({ ...DEFAULT_PREFS, timeZone: farmTimeZone() });
  const future = parsed.data.sourcesChecked.findIndex((c) => c.checkedAt > today);
  if (future >= 0) {
    return json(
      {
        error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
        message: t(event.locals?.locale, 'stockui.api.seedFuture'),
        issues: [{ path: `sourcesChecked.${future}.checkedAt`, message: 'after today' }]
      },
      { status: 400 }
    );
  }
  const sourcing = setLotSeedSourcing(found.lot.id, parsed.data);
  return json({ sourcing }, { headers: { 'cache-control': 'private, no-store' } });
};
