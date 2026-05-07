/**
 * GET /api/insecticide
 *
 * Lists recent insecticide events for /insecticides + /today re-entry banner.
 * Read-only — accessible to every signed-in role including inspector.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { activeReEntryRestrictions, listInsecticideEvents } from '$lib/db/insecticideEvents';

export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const events = listInsecticideEvents({ blockId, limit });
  const activeREI = activeReEntryRestrictions();
  return json({ events, activeREI });
};
