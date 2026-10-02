import { redirect } from '@sveltejs/kit';
import { getRegistry } from '$lib/server/registry';
import { loadSowingCalendar } from '$lib/calendar/sowingCalendar.server';
import { loadEffectiveFrostByBlock } from '$lib/server/blockFrost.server';
import type { PageServerLoad } from './$types';

/** Query params of the month grid that moved to /plan?tab=calendar. */
const LEGACY_PARAMS = ['view', 'month', 'tab'];

export const load: PageServerLoad = async ({ url, locals }) => {
  if (LEGACY_PARAMS.some((k) => url.searchParams.has(k))) {
    const sp = new URLSearchParams(url.searchParams);
    sp.set('tab', 'calendar');
    throw redirect(307, `/plan?${sp.toString()}`);
  }
  if (!locals.user) throw redirect(303, '/');
  if (!locals.user.activeOwnerId) throw redirect(303, '/owner-picker');

  const now = Date.now();
  const registry = await getRegistry();
  return {
    nowMs: now,
    ...loadSowingCalendar(registry, url.searchParams.get('year'), now, {
      frostByBlock: loadEffectiveFrostByBlock,
      locale: locals?.locale
    })
  };
};
