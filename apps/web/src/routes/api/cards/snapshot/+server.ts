/**
 * GET /api/cards/snapshot — the active Owner's offline Card bundle
 * (`FarmSnapshot`). Helpers may read it, like every inventory view. Sends a
 * weak ETag and answers 304 to a matching If-None-Match.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { buildFarmSnapshot, etagMatches, snapshotEtag } from '$lib/server/cardSnapshot';

const CACHE_HEADERS = {
  'cache-control': 'private, no-cache',
  vary: 'Cookie, Authorization'
};

function configuredOrigin(): string | null {
  return process.env.ORIGIN?.trim() || null;
}

export const GET: RequestHandler = async (event) => {
  requireUser(event);
  const snapshot = await buildFarmSnapshot({ origin: configuredOrigin() });
  const etag = snapshotEtag(snapshot);
  if (etagMatches(event.request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { ...CACHE_HEADERS, etag } });
  }
  return json(snapshot, { headers: { ...CACHE_HEADERS, etag } });
};
