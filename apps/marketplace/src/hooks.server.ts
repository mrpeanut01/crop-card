import type { Handle, HandleServerError } from '@sveltejs/kit';
import { lookupByPlaintext, touchCredential } from '$lib/server/appCreds';
import { readAdminSession } from '$lib/server/adminSession';
import { ensureBootstrapped } from '$lib/server/bootstrap';

/**
 * Request pipeline:
 *   1. Boot-time bootstrap (idempotent — seed cred + admin users).
 *   2. Resolve auth:
 *        - Authorization: Bearer ccm_… → look up app credential
 *        - marketplace.session cookie → look up admin session
 *   3. Auth gate for /api/v1/** (Bearer required in 'internet' mode;
 *      GET allowed unauthenticated in 'intranet' mode; /api/v1/health
 *      is always public).
 *   4. CSRF bridge: for cookie-session mutation requests, enforce a
 *      matching Origin. Bearer-authed requests skip — agents call from
 *      arbitrary origins by design.
 *   5. resolve() — SvelteKit runs the route handler.
 */
export const handle: Handle = async ({ event, resolve }) => {
  ensureBootstrapped();

  // 2. Auth resolution
  const authHeader = event.request.headers.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    let cred: ReturnType<typeof lookupByPlaintext>;
    try {
      cred = lookupByPlaintext(token);
    } catch {
      return new Response(
        JSON.stringify({ error: 'invalid or revoked Bearer token' }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );
    }
    if (cred) {
      event.locals.app = cred;
      event.locals.authVia = 'bearer';
      try {
        touchCredential(cred.id);
      } catch {
        // touch is best-effort; do not propagate DB errors back to the agent.
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'invalid or revoked Bearer token' }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );
    }
  } else {
    const session = readAdminSession(event.cookies);
    if (session) {
      event.locals.admin = session;
      event.locals.authVia = 'cookie';
    }
  }

  // 3. /api/v1/** auth gate
  const path = event.url.pathname;
  const isApiV1 = path.startsWith('/api/v1/');
  const isHealth = path === '/api/v1/health';
  if (isApiV1 && !isHealth && !event.locals.app) {
    const mode = process.env.MARKETPLACE_MODE ?? 'internet';
    const intranetReadAllowed = mode === 'intranet' && event.request.method === 'GET';
    if (!intranetReadAllowed) {
      return new Response(
        JSON.stringify({ error: 'authentication required: send Authorization: Bearer ccm_…' }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );
    }
  }

  // 4. CSRF bridge — cookie-session form POSTs need matching Origin.
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.request.method);
  if (isMutation && event.locals.authVia !== 'bearer') {
    const origin = event.request.headers.get('origin');
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== event.url.host) {
          return new Response('cross-origin POST blocked', { status: 403 });
        }
      } catch {
        return new Response('malformed Origin header', { status: 400 });
      }
    }
  }

  return resolve(event);
};

/** Structured server-error visibility — never opaque "Internal error". */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const errId = crypto.randomUUID();
  console.error(
    JSON.stringify({
      tag: 'server-error',
      errId,
      route: event.route.id,
      method: event.request.method,
      url: event.url.pathname,
      status,
      message,
      stack: error instanceof Error ? error.stack : String(error)
    })
  );
  return { message, errId } as App.Error;
};
