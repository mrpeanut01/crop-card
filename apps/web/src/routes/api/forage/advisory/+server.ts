/**
 * GET /api/forage/advisory?fieldId=<id> | ?hayCuttingId=<id> (Phase 33C,
 * M-53). Every role. The prussic acid and nitrate advisory for an Area or a
 * hay cutting, fetched in the browser when a card or sheet opens. Advisory
 * only: it never changes a move or a hay response.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { ForageTargetNotFound, loadForageAdvisory } from '$lib/server/forageAdvisory';

export const GET: RequestHandler = async (event) => {
  requireUser(event);
  const fieldId = event.url.searchParams.get('fieldId');
  const hayCuttingId = event.url.searchParams.get('hayCuttingId');
  if (!!fieldId === !!hayCuttingId) {
    return json(
      {
        error: 'INVALID',
        message: 'Ask about one Area (fieldId) or one hay cutting (hayCuttingId).'
      },
      { status: 400 }
    );
  }
  try {
    const advisory = await loadForageAdvisory(
      fieldId ? { fieldId } : { hayCuttingId: hayCuttingId as string }
    );
    return json({ advisory }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (e) {
    if (e instanceof ForageTargetNotFound) {
      return json(
        { error: 'NOT_FOUND', message: 'That place or cutting is not on this farm.' },
        { status: 404 }
      );
    }
    throw e;
  }
};
