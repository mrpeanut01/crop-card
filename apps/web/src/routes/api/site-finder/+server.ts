import { json, type RequestHandler } from '@sveltejs/kit';
import { getField } from '$lib/db/fields';
import { t } from '$lib/i18n';
import { requireOwner } from '$lib/server/auth';
import { realNow } from '$lib/server/clock';
import { firstUnknownRef, type ForeignRef } from '$lib/server/foreignRefs';
import { runSiteFinder } from '$lib/server/siteFinder/run';
import { siteFinderRequestSchema } from '$lib/siteFinder/apiSchemas';

export const _requestSchema = siteFinderRequestSchema;

const WINDOW_MS = 60_000;
export const _SITE_FINDER_PER_MINUTE = 6;
const hits = new Map<string, number[]>();

/** In-process sliding window (single replica, Invariant 3). */
function allowRun(userId: string, now = realNow()): boolean {
  const recent = (hits.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= _SITE_FINDER_PER_MINUTE) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (v.every((at) => now - at >= WINDOW_MS)) hits.delete(k);
  }
  return true;
}

export function _resetSiteFinderRateLimit(): void {
  hits.clear();
}

/** POST /api/site-finder (Phase 38D). Up to three places for a plot inside
 *  the search box, from sun math, the owner's map and the USDA soil survey,
 *  with Claude's reading of a USDA NAIP aerial photo when asked for and
 *  available. Owner only. Saves nothing: the owner creates the Area through
 *  POST /api/fields. Never gates anything (P-8). */
export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const locale = event.locals?.locale;
  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: t(locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = siteFinderRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      { error: t(locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const refs: ForeignRef[] = (parsed.data.allowOverlapAreaIds ?? []).map(
    (id) => ['allowOverlapAreaIds', id, getField] as const
  );
  const unknown = firstUnknownRef(...refs);
  if (unknown) {
    return json(
      { error: t(locale, 'api.err.unknownRef', { field: unknown }), code: 'FOREIGN_REF' },
      { status: 400 }
    );
  }
  if (!allowRun(user.id)) {
    return json({ error: t(locale, 'sitefinder.err.tooMany') }, { status: 429 });
  }
  const result = await runSiteFinder({ userId: user.id, req: parsed.data, locale });
  return json(result, { headers: { 'cache-control': 'no-store' } });
};
