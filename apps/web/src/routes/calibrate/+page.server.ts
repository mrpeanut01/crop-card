import type { PageServerLoad } from './$types';
import { listSprayers } from '$lib/server/sprayers';
import { listPendingCalibrations } from '$lib/server/pendingCalibrations';

export const load: PageServerLoad = ({ locals }) => {
  const isOwner = locals.user?.role === 'owner';
  return {
    sprayers: listSprayers(),
    canSave: isOwner,
    // Owner sees pending calibrations for review; helper sees an empty list.
    pendingCalibrations: isOwner ? listPendingCalibrations() : []
  };
};
