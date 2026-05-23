/**
 * /calendar — top-nav entry point for the Calendar view (Phase 21b
 * follow-up).
 *
 * Phase 1 implementation: server-side 302 redirect to the Plan tab.
 * The Calendar tab inside /plan already supports the swimlane | grid
 * toggle + field/block filters, so a redirect gets the operator to
 * the full UI without duplicating the (large) template.
 *
 * Query params pass through: ?view=swimlane or ?view=grid, ?ym=YYYY-MM,
 * ?field=<id>, ?block=<id> all preserved on the redirect so deep
 * links from external sources land on the right view.
 *
 * A future Phase will split out a focused /calendar route that strips
 * the Plan tab strip + Plan-wizard buttons — see GH issue #54 for the
 * layout polish that this can roll into.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
  const target = new URL('/plan', url);
  target.searchParams.set('tab', 'calendar');
  // Pass through any view/filter params the caller supplied.
  for (const [key, value] of url.searchParams) {
    if (key === 'tab') continue;
    target.searchParams.set(key, value);
  }
  throw redirect(302, target.pathname + target.search);
};
