import { t } from '$lib/i18n';
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
        message: t(event.locals?.locale, 'api.err.forageAskOne')
      },
      { status: 400 }
    );
  }
  try {
    const advisory = await loadForageAdvisory(
      fieldId ? { fieldId } : { hayCuttingId: hayCuttingId as string },
      Date.now(),
      {},
      event.locals?.locale
    );
    return json({ advisory }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (e) {
    if (e instanceof ForageTargetNotFound) {
      return json(
        { error: 'NOT_FOUND', message: t(event.locals?.locale, 'api.err.forageNotOnFarm') },
        { status: 404 }
      );
    }
    throw e;
  }
};
