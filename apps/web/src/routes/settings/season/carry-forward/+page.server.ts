import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { requireOwner } from '$lib/server/auth';
import { carryForwardSeasonAsync } from '$lib/season/carryForward.server';

export const load: PageServerLoad = async (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw redirect(303, '/owner-picker');

  const toYear = new Date().getFullYear() + 1;
  const fromYear = toYear - 1;

  // Dry-run preview — no side effects. The operator confirms + applies from
  // the UI, which POSTs /api/season/carry-forward with apply:true.
  const preview = await carryForwardSeasonAsync({ fromYear, toYear, apply: false });

  return { fromYear, toYear, preview };
};
