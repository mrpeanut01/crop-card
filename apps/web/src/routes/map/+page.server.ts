/**
 * Phase 13: /map absorbed into /plan?tab=layout.
 * Old bookmarks redirect; the polygon paste UI + SVG renderer live in the
 * Layout tab on /plan.
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
  throw redirect(307, '/plan?tab=layout');
};
