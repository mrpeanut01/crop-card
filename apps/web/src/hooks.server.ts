import { json, type Handle } from '@sveltejs/kit';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Two-line role enforcement at the request boundary:
 *   1. Annotate `event.locals.user` so downstream loads can render role chips.
 *   2. Reject any inspector-session attempt to mutate via /api/*. Endpoints
 *      that mutate via form-actions (signin/signout) are exempt because the
 *      inspector role cannot reach those flows once signed in. Each endpoint
 *      may still apply its own finer-grained check (e.g. owner-only).
 */
export const handle: Handle = async ({ event, resolve }) => {
  const user = currentUser(event);
  if (user) event.locals.user = user;

  if (
    user &&
    !canMutate(user.role) &&
    MUTATION_METHODS.has(event.request.method) &&
    event.url.pathname.startsWith('/api/')
  ) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  return resolve(event);
};
