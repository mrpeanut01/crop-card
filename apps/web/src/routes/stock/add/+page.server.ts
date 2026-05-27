/**
 * Sprint 9 / Phase 27E (#257) — legacy `/stock/add` redirect.
 *
 * The 5-method add flow lives at `/inventory/[type]/add` (Phase 27D).
 * The legacy /stock/add tab strip + capture plumbing is preserved in
 * git history but no longer renders; this loader permanently redirects
 * to the unified add form, defaulting to the pesticide type which is
 * the original /stock/add land-on.
 */
import { redirect, type ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = () => {
  throw redirect(308, '/inventory/pesticide/add');
};
