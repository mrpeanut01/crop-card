/**
 * Sprint 9 / Phase 27E (#257) — legacy `/settings/plugins` redirect.
 *
 * Plugin browsing now lives on the unified inventory surface in
 * `mode=catalog` (Phase 27B). The summary tile under /settings was a
 * Phase 25c shim and is removed. Bookmarks 308-permanent-redirect to
 * the pesticide catalog tab as the default; the user can swap the
 * type chip from there to land on crop / fertility / etc.
 *
 * The full /plugins management UI (browse + upload + diff) is a
 * separate route and is unaffected.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
  throw redirect(308, '/inventory?type=pesticide&mode=catalog');
};
