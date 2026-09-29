import type { PageServerLoad } from './$types';
import { listSprayers } from '$lib/server/sprayers';
import { listPendingCalibrations } from '$lib/server/pendingCalibrations';

export const load: PageServerLoad = ({ locals, url }) => {
  const isOwner = locals.user?.role === 'owner';
  const sprayers = listSprayers();
  const asked = url.searchParams.get('sprayer');
  return {
    sprayers,
    initialSprayerId: sprayers.some((s) => s.id === asked) ? asked : null,
    canSave: isOwner,
    // Owner sees pending calibrations for review; helper sees an empty list.
    pendingCalibrations: isOwner ? listPendingCalibrations() : []
  };
};
