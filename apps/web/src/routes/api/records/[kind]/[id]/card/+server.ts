/**
 * GET /api/records/:kind/:id/card: the read-only Card a /records row expands
 * into, for the active Owner. Helpers may read it, like /records itself.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { prefsFor } from '$lib/db/userProfile';
import { buildRecordCards, isRecordKind } from '$lib/server/recordCards';

export const GET: RequestHandler = async (event) => {
  const user = requireUser(event);
  const { kind, id } = event.params;
  if (!kind || !id || !isRecordKind(kind)) throw error(404, 'No such record');
  const result = await buildRecordCards(kind, id, {
    prefs: prefsFor(user.id),
    origin: process.env.ORIGIN?.trim().replace(/\/+$/, '') || null
  });
  if (!result) throw error(404, 'No such record');
  return json(result, {
    headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' }
  });
};
