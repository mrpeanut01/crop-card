/**
 * F2-1: who can reach money. Owner role only, for pages and APIs. An owner
 * Bearer token may read and write; impersonation may read and never write.
 */

import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser, type AuthenticatedUser } from '$lib/server/auth';

export const MONEY_OWNER_ONLY = 'Money is only shown to the farm owner.';

export function requireMoneyReader(event: RequestEvent): AuthenticatedUser {
  const user = requireUser(event);
  if (user.role !== 'owner') throw error(403, MONEY_OWNER_ONLY);
  return user;
}

export function requireMoneyWriter(event: RequestEvent): AuthenticatedUser {
  const user = requireMoneyReader(event);
  if (user.impersonating) throw error(403, 'Money cannot be changed while impersonating.');
  return user;
}
