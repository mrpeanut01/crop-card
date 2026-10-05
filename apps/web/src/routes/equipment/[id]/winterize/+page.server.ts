import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEquipment } from '$lib/db/equipment';
import { getSprayer } from '$lib/server/sprayers';
import { selectDeconProtocol } from '$lib/safety/deconProtocol';
import { canMutate } from '$lib/server/session';

export const load: PageServerLoad = ({ params, locals }) => {
  if (!params.id) throw error(400, 'id required');
  const equipment = getEquipment(params.id);
  if (!equipment) throw error(404, `unknown equipment: ${params.id}`);
  if (equipment.type !== 'sprayer') {
    throw error(400, 'winterization applies to sprayers only');
  }
  const sprayer = getSprayer(params.id);
  const protocol = selectDeconProtocol(sprayer?.lastChemistryClass ?? null);

  return {
    equipment,
    sprayer,
    protocol,
    // Helper+ may run winterization (same crew as UC-04 decon); inspectors
    // are read-only and the API refuses them too.
    canWinterize: !!locals.user && canMutate(locals.user.role)
  };
};
