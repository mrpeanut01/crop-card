/**
 * Sprint 9 / Phase 27E (#257) — legacy `/settings/sprayers` redirect.
 *
 * Sprayer roster + calibration + decon status now live on the unified
 * inventory surface (`/inventory?type=sprayer`) and per-sprayer detail
 * (`/inventory/sprayer/[id]`) introduced in Phase 27B+C. The dedicated
 * calibration wizard (`/calibrate`) and equipment edit (`/equipment/[id]`)
 * are unaffected — they stay where they are and are linked from the new
 * detail surface.
 */
import { redirect, type ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = () => {
  throw redirect(308, '/inventory?type=sprayer');
};
