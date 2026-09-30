import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { usersForOwner } from '$lib/db/users';
import { farmTimeZone } from '$lib/db/userProfile';
import { ymdInZone } from '$lib/prefs';
import { mondayOf } from '$lib/digest/weekly';
import { buildDigestCard } from '$lib/cards/build/digest';
import { digestEligible, loadDigestSource } from '$lib/server/push/weeklyDigest';

/** The Monday summary to read or print (F4-9). Never any money: that is
 *  only in the owner's email. */
export const load: PageServerLoad = async ({ locals, parent }) => {
  const user = locals.user;
  if (!user?.activeOwnerId) throw redirect(303, '/');
  const { activeOwner } = await parent();
  const now = Date.now();
  const monday = mondayOf(ymdInZone(now, farmTimeZone()));
  const eligible = digestEligible(usersForOwner(user.activeOwnerId));
  const source = loadDigestSource({
    monday,
    now,
    memberIds: [...eligible.keys()],
    withCash: false
  });
  const isOwner = user.role === 'owner';
  const digest = source.digestFor(user.id, isOwner, false);
  return {
    card: buildDigestCard(digest, {
      asOf: now,
      farmName: activeOwner?.name ?? null,
      viewerName: source.people[user.id] ?? null,
      listLimit: Number.POSITIVE_INFINITY
    })
  };
};
