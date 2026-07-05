import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { requireUser } from '$lib/server/auth';
import { canReopen } from '$lib/server/seasonClose';
import { getCloseout } from '$lib/db/seasonCloseouts';
import { buildCloseoutPreflight } from '$lib/season/closeout.server';

export const load: PageServerLoad = (event) => {
  // Helpers may VIEW the close-out checklist (read-only); only owners can
  // close/reopen. Gate the mutation server-side in /api/season/close.
  const u = requireUser(event);
  if (!u.activeOwnerId) throw redirect(303, '/owner-picker');

  const year = new Date().getFullYear();
  const preflight = buildCloseoutPreflight(year);
  const existing = getCloseout(year);
  const closed = !!existing && existing.reopenedAt === null;

  return {
    year,
    isOwner: u.role === 'owner',
    preflight,
    closed,
    closeout: existing,
    reopenAvailable: closed && canReopen(year)
  };
};
