import { json, type RequestEvent } from '@sveltejs/kit';
import type { AuthenticatedUser } from './auth';

/**
 * C-01, C-32: withdrawal numbers, grazing attestations, an on-label
 * confirmation and "this was never given" are typed by the owner from the
 * label or the vet. An API token acts with the owner's role, and a
 * superadmin impersonating a farm is not its owner, so neither counts.
 */
export function isInteractiveOwner(
  event: Pick<RequestEvent, 'locals'>,
  user: Pick<AuthenticatedUser, 'role' | 'impersonating'>
): boolean {
  if (user.role !== 'owner') return false;
  if (event.locals?.authVia === 'bearer') return false;
  return user.impersonating !== true;
}

export const INTERACTIVE_OWNER_ONLY =
  'Only the owner, signed in on their own account, can enter or confirm withdrawal and grazing numbers.';

export function interactiveOwnerRefusal(): Response {
  return json({ error: INTERACTIVE_OWNER_ONLY, code: 'INTERACTIVE_OWNER_ONLY' }, { status: 403 });
}
