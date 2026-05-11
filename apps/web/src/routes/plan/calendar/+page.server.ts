/**
 * Phase 13: /plan/calendar absorbed into /plan?tab=calendar.
 * This loader redirects so existing bookmarks keep working.
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
  const sp = new URLSearchParams(url.searchParams);
  sp.set('tab', 'calendar');
  throw redirect(307, `/plan?${sp.toString()}`);
};
