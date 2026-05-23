/**
 * Auth guards — call these from any route handler to assert the
 * required authentication state. They throw SvelteKit `error()` /
 * `redirect()` which propagates the right HTTP response.
 */

import { error, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export function requireApp(event: RequestEvent) {
  if (!event.locals.app) {
    throw error(401, 'authentication required: send Authorization: Bearer ccm_…');
  }
  return event.locals.app;
}

export function requireAdmin(event: RequestEvent) {
  if (!event.locals.admin) {
    throw redirect(302, `/admin/login?next=${encodeURIComponent(event.url.pathname)}`);
  }
  return event.locals.admin;
}

/**
 * For mutations from Bearer-authed apps that need a `trusted` credential —
 * e.g., any future endpoint that can bypass quarantine. Reads of approved
 * data don't need this gate.
 */
export function requireTrustedApp(event: RequestEvent) {
  const app = requireApp(event);
  if (app.trustLevel !== 'trusted') {
    throw error(403, 'this endpoint requires a trusted credential');
  }
  return app;
}
