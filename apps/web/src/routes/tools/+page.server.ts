import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth';
import { getSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';

export const load: PageServerLoad = (event) => {
  requireUser(event);
  // Phase 21 (B-29): planter-plate selector is niche — only relevant when
  // the operator runs a plate-based precision planter (Earthway, John
  // Deere). Off by default; opt-in via Settings → Display.
  const showPlanterPlate = getSetting(SETTINGS_KEYS.displayPlanterSetup) === 'true';
  return { showPlanterPlate };
};
