/**
 * DELETE /api/sprayers/:id — removes a legacy `sprayers` row, owner only.
 *
 * The equipment table is the long-term home for sprayers; this endpoint
 * exists so testers can clear out stale legacy rows. It never deletes
 * spray records: those carry the FR-09 lock and the grazing and hay holds,
 * so they are removed one at a time from Records. While any spray record
 * points at the id it is refused.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { countSprayEventsForSprayer, deleteSprayerCascade } from '$lib/db/admin';
import { requireOwner } from '$lib/server/auth';

export const DELETE: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'id required');
  requireOwner(event);
  if (countSprayEventsForSprayer(event.params.id) > 0) {
    return json(
      {
        error:
          'Spray records use this sprayer. Remove them one at a time from Records first, since they can hold grazing, hay and harvest times.',
        code: 'SPRAYER_HAS_RECORDS'
      },
      { status: 409 }
    );
  }
  return json(deleteSprayerCascade(event.params.id));
};
