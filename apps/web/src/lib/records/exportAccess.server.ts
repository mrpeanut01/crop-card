/** 33B (B-48): the treatment log and the certifier pack are for the owner
 *  (cookie or Bearer) and inspectors. An impersonating superadmin reads as
 *  the owner. Helpers get 403. Never gated by the season close-out or a
 *  billing suspension: these are record exports. */

import { json, type RequestEvent } from '@sveltejs/kit';
import { requireUser, type AuthenticatedUser } from '$lib/server/auth';

export function recordExportReader(
  event: RequestEvent
): { ok: true; user: AuthenticatedUser } | { ok: false; response: Response } {
  const user = requireUser(event);
  if (user.role === 'owner' || user.role === 'inspector') return { ok: true, user };
  return {
    ok: false,
    response: json(
      {
        error: 'OWNER_OR_INSPECTOR_ONLY',
        message: 'Only the farm owner or an inspector can download this.'
      },
      { status: 403 }
    )
  };
}
