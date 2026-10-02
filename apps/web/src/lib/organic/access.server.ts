import { json } from '@sveltejs/kit';
import type { AuthenticatedUser } from '$lib/server/auth';

/** B-12: statuses and reviews are statements the farm makes to its
 *  certifier. The owner makes them, by cookie or the owner's own token;
 *  never a helper, an inspector or a superadmin impersonating the farm. */
export function organicWriteRefusal(
  user: Pick<AuthenticatedUser, 'role' | 'impersonating'>
): Response | null {
  if (user.impersonating) {
    return json(
      {
        error: 'NOT_WHILE_IMPERSONATING',
        message: 'Organic statuses cannot be entered while impersonating a farm.'
      },
      { status: 403 }
    );
  }
  if (user.role !== 'owner') {
    return json(
      { error: 'OWNER_ONLY', message: 'Only the owner can enter organic statuses and reviews.' },
      { status: 403 }
    );
  }
  return null;
}

export function invalidBody(issues: { path: PropertyKey[]; message: string }[]): Response {
  return json(
    {
      error: 'invalid request',
      issues: issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }))
    },
    { status: 400 }
  );
}
