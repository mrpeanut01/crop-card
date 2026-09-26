/**
 * GET /api/cards/snapshot — the active Owner's offline Card bundle
 * (`FarmSnapshot`). Helpers may read it, like every inventory view. Sends a
 * weak ETag (a hash of the content) and answers 304 to a matching
 * If-None-Match. When nothing the snapshot depends on has changed since the
 * last build for this Owner (`snapshotStateKey`), the 304 is decided without
 * building it again.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import {
  buildFarmSnapshot,
  etagMatches,
  knownSnapshotEtag,
  rememberSnapshotEtag,
  snapshotEtag,
  snapshotStateKey
} from '$lib/server/cardSnapshot';

const CACHE_HEADERS = {
  'cache-control': 'private, no-cache',
  vary: 'Cookie, Authorization'
};

function configuredOrigin(): string | null {
  return process.env.ORIGIN?.trim() || null;
}

export const GET: RequestHandler = async (event) => {
  requireUser(event);
  const now = Date.now();
  const origin = configuredOrigin();
  const ifNoneMatch = event.request.headers.get('if-none-match');
  const key = await snapshotStateKey({ now, origin });
  const known = knownSnapshotEtag(key);
  if (known && etagMatches(ifNoneMatch, known)) {
    return new Response(null, { status: 304, headers: { ...CACHE_HEADERS, etag: known } });
  }
  const snapshot = await buildFarmSnapshot({ now, origin });
  const etag = snapshotEtag(snapshot);
  rememberSnapshotEtag(key, etag);
  if (etagMatches(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: { ...CACHE_HEADERS, etag } });
  }
  return json(snapshot, { headers: { ...CACHE_HEADERS, etag } });
};
