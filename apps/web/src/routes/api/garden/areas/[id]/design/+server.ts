import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { loadDesignerResponse } from '$lib/server/gardenDesignLoad';

/** GET /api/garden/areas/[id]/design?season=YYYY. The garden designer's
 *  data for any signed-in role; only the owner gets `canEdit`. Another
 *  Owner's Area, or one that is not a garden or greenhouse, is a 404. */
export const GET: RequestHandler = async (event) => {
  const user = requireUser(event);
  const body = await loadDesignerResponse(event.params.id ?? '', {
    role: user.role,
    season: event.url.searchParams.get('season')
  });
  if (!body) {
    return json(
      { error: 'This Area has no garden designer. Only gardens and greenhouses do.' },
      { status: 404 }
    );
  }
  return json(body, { headers: { 'cache-control': 'no-store' } });
};
