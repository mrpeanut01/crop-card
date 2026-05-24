import { json, redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { currentUser } from '$lib/server/auth';
import { canMutate, type SessionRole } from '$lib/server/session';
import { activeAssignmentsForUser } from '$lib/db/users';
import { runWithTenantAsync } from '$lib/db/tenant';
import { db } from '$lib/db/client';
import { owners, users, helperAssignments } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { lookupByPlaintext, touchToken } from '$lib/server/apiTokens';

/**
 * Phase 21a follow-up — error visibility (2026-05-17).
 *
 * SvelteKit's default `handleError` swallows server-side errors into a
 * generic "Internal Error" body with no stack trace logged. That made the
 * Phase 21a `/plan` 500 (server-only `lib/db/settings` leaking into the
 * client bundle via `lib/season/setup.ts`) invisible in `docker logs` —
 * we spent half a debugging session blind.
 *
 * This hook fixes that by:
 *   1. Dumping a structured trace line for every server error (loader,
 *      action, endpoint, SSR component throw) with method, path, user,
 *      and full stack.
 *   2. Returning a richer `message` field in dev mode so the inline 500
 *      shows the actual error text (the browser still gets the generic
 *      "Internal Error" body in prod for security).
 *
 * Add the same shape to client errors via `+error.svelte` if the need
 * surfaces — for now server visibility is the priority.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const summary = error instanceof Error ? error.message : String(error ?? 'unknown error');
  const stack = error instanceof Error ? error.stack : undefined;
  // ANSI red for visibility in the docker logs stream.
  console.error(
    '\x1b[1;31m[server-error]\x1b[0m',
    JSON.stringify(
      {
        status,
        method: event.request.method,
        path: event.url.pathname,
        search: event.url.search || undefined,
        user: event.locals.user?.email ?? null,
        activeOwnerId: event.locals.user?.activeOwnerId ?? null,
        message: summary,
        sveltekitMessage: message
      },
      null,
      2
    )
  );
  if (stack) console.error('\x1b[1;31m[server-error stack]\x1b[0m\n' + stack);
  // Surface the actual message in dev so the browser overlay / inline 500
  // shows it. In prod we keep the opaque default for security.
  if (process.env.NODE_ENV !== 'production') {
    return { message: `Server error: ${summary}` };
  }
  return undefined;
};

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Routes that don't require ANY session. Hitting these without a cookie
// renders normally; everywhere else redirects to `/` (the landing/signin).
// Keep this list tight — every new public surface is a potential
// pre-auth attack surface.
const ANONYMOUS_PATHS = new Set([
  '/',
  '/signin',
  '/signout',
  '/api/health',
  '/api/openapi.json' // Phase 24 — external agents fetch the OpenAPI doc pre-auth.
]);
const ANONYMOUS_PATH_PREFIXES = ['/invite/', '/api/health/'];
const ANONYMOUS_STATIC_PATHS = new Set([
  '/manifest.webmanifest',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml'
]);
const ANONYMOUS_STATIC_PREFIXES = [
  '/_app/', // SvelteKit-built JS/CSS bundles
  '/icon-', // PWA icons (/icon-192.png, /icon-512.png)
  '/img/',
  '/static/'
];

function isAnonymous(pathname: string): boolean {
  if (ANONYMOUS_PATHS.has(pathname)) return true;
  if (ANONYMOUS_STATIC_PATHS.has(pathname)) return true;
  for (const p of ANONYMOUS_PATH_PREFIXES) if (pathname.startsWith(p)) return true;
  for (const p of ANONYMOUS_STATIC_PREFIXES) if (pathname.startsWith(p)) return true;
  // Vite dev-mode internals & the SvelteKit service worker — never sit
  // behind auth.
  if (pathname.startsWith('/@')) return true;
  if (pathname.startsWith('/node_modules/')) return true;
  if (pathname === '/service-worker.js' || pathname.startsWith('/workbox-')) return true;
  // /_dev/* routes (visual references, primitives playground) are gated
  // by the route's own load function (dev || superadmin || ENABLE_DEV_ROUTES).
  // Letting them through the global auth funnel here means the route gate
  // is the only gate — and Playwright's visual baseline doesn't need an
  // auth cookie just to render the primitives page.
  if (pathname.startsWith('/_dev/')) return true;
  return false;
}

// Authenticated routes that work with a partial session (no
// `activeOwnerId` yet). These exist to *complete* the session — onboarding
// creates an Owner, the picker selects one, switch-owner re-mints the
// cookie.
const PARTIAL_SESSION_PATHS = new Set([
  '/owner-picker',
  '/onboarding',
  '/signout',
  '/api/session/switch-owner'
]);

function allowsPartialSession(pathname: string): boolean {
  if (PARTIAL_SESSION_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/onboarding/')) return true;
  if (pathname.startsWith('/owner-picker/')) return true;
  return false;
}

/**
 * Phase 24 — CSRF / Origin guard decision.
 *
 * Returns one of:
 *   - 'allow'                  — let the request through
 *   - 'block-cross-origin'     — Origin host mismatches the app host → 403
 *   - 'malformed-origin'       — Origin header isn't a parseable URL → 400
 *
 * Policy:
 *   - Mutation under /api/** with Bearer auth → allow regardless of Origin
 *     (external agents call from arbitrary origins by design).
 *   - Mutation under a non-/api/** path → enforce same-origin even when
 *     Bearer is set. Form-actions belong to the cookie-session UI and
 *     should never accept cross-origin POSTs.
 *   - Cookie-authed mutations under /api/** → enforce same-origin when
 *     an Origin header is present (browser-style request).
 *   - Mutations with no Origin header at all → allow. Origin is browser-
 *     only; curl / server-to-server cookie POSTs lack it by definition.
 *
 * Exported so the integration test can exercise the matrix directly
 * without spinning up SvelteKit.
 */
export type CsrfDecision = 'allow' | 'block-cross-origin' | 'malformed-origin';
export function csrfDecision(input: {
  method: string;
  pathname: string;
  origin: string | null;
  host: string;
  authVia?: 'cookie' | 'bearer';
}): CsrfDecision {
  if (!MUTATION_METHODS.has(input.method)) return 'allow';
  const underApi = input.pathname.startsWith('/api/');
  const skipForBearer = input.authVia === 'bearer' && underApi;
  if (skipForBearer) return 'allow';
  if (!input.origin) return 'allow';
  let originHost: string;
  try {
    originHost = new URL(input.origin).host;
  } catch {
    return 'malformed-origin';
  }
  if (originHost !== input.host) return 'block-cross-origin';
  return 'allow';
}

/**
 * Request boundary (Phase 18 final + Phase 24 Bearer auth):
 *   0. (Phase 24) Resolve `Authorization: Bearer cck_…` BEFORE cookie
 *      lookup. Hit → mint an AuthenticatedUser-shaped record from the
 *      token's (ownerId, userId, role). Miss → return 401 JSON
 *      immediately. Absent → fall through to cookie path.
 *   1. Decorate `event.locals.user` so downstream loads can render.
 *   2. Inspector role can't mutate via /api/*.
 *   3. Unauthenticated requests to non-public paths redirect to `/` so
 *      the landing/signin is the single funnel. API routes get 401 JSON
 *      instead of a 303 (clients should re-auth, not follow redirects
 *      blindly).
 *   4. Partial sessions (no `activeOwnerId`) bounce to /owner-picker or
 *      /onboarding depending on assignment count.
 *   5. Suspended Owners get 402.
 *   6. Wrap `resolve(event)` in `runWithTenant(activeOwnerId, …)` so
 *      tenant-scoped repos see the right Owner.
 */
export const handle: Handle = async ({ event, resolve }) => {
  // Phase 24 — Bearer-first auth resolution.
  const authHeader = event.request.headers.get('authorization');
  let user: ReturnType<typeof currentUser> = null;
  if (authHeader && /^bearer\s+/i.test(authHeader)) {
    const plaintext = authHeader.replace(/^bearer\s+/i, '').trim();
    const resolved = lookupByPlaintext(plaintext);
    if (!resolved) {
      return json(
        { error: 'invalid or revoked Bearer token' },
        { status: 401, headers: { 'cache-control': 'no-store' } }
      );
    }
    const built = buildBearerUser(resolved);
    if (!built) {
      // Token is valid but its underlying assignment was revoked. Treat
      // as a revoked token so the agent retries with a fresh credential.
      return json(
        { error: 'token user no longer has an active assignment for this owner' },
        { status: 401, headers: { 'cache-control': 'no-store' } }
      );
    }
    user = built;
    event.locals.user = built;
    event.locals.authVia = 'bearer';
    event.locals.tokenId = resolved.tokenId;
    event.locals.isServiceAccountToken = resolved.isServiceAccount;
    touchToken(resolved.tokenId);
  } else {
    user = currentUser(event);
    if (user) {
      event.locals.user = user;
      event.locals.authVia = 'cookie';
    }
  }
  const path = event.url.pathname;

  // Phase 24 — CSRF / Origin bridge. SvelteKit's built-in check is
  // disabled globally in svelte.config.js; we replace it with the
  // targeted guard in csrfDecision() above so external Bearer agents
  // can call /api/** from arbitrary origins while cookie sessions stay
  // strictly same-origin.
  if (MUTATION_METHODS.has(event.request.method)) {
    const decision = csrfDecision({
      method: event.request.method,
      pathname: path,
      origin: event.request.headers.get('origin'),
      host: event.url.host,
      authVia: event.locals.authVia
    });
    if (decision !== 'allow') {
      return json(
        {
          error:
            decision === 'block-cross-origin'
              ? 'cross-origin request blocked'
              : 'malformed Origin header'
        },
        {
          status: decision === 'block-cross-origin' ? 403 : 400,
          headers: { 'cache-control': 'no-store' }
        }
      );
    }
  }

  if (
    user &&
    !canMutate(user.role) &&
    MUTATION_METHODS.has(event.request.method) &&
    path.startsWith('/api/')
  ) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  if (!user) {
    if (isAnonymous(path)) return resolve(event);
    if (path.startsWith('/api/')) {
      return json({ error: 'authentication required' }, { status: 401 });
    }
    // Preserve the original target so the landing can stash it for a
    // post-signin redirect (future enhancement); today we drop it and
    // route everyone to /today after auth.
    throw redirect(303, '/');
  }

  // Partial session: complete it via picker or onboarding.
  if (!user.activeOwnerId) {
    if (allowsPartialSession(path)) return resolve(event);
    if (isAnonymous(path)) return resolve(event);
    const next = pickRedirectForPartialSession(user.id);
    throw redirect(303, next);
  }

  // Billing gate: suspended tenants stop everywhere except superadmin
  // surfaces (so support can remediate) and the landing itself.
  if (!isAnonymous(path) && !allowsPartialSession(path) && !path.startsWith('/admin')) {
    const billing = ownerBillingStatus(user.activeOwnerId);
    if (billing === 'suspended') {
      return new Response('Tenant suspended — contact support@cropcard.local.', {
        status: 402
      });
    }
  }

  return runWithTenantAsync(user.activeOwnerId, () => Promise.resolve(resolve(event)));
};

/**
 * Build an AuthenticatedUser from a Bearer-resolved token. Looks up the
 * email + role-within-owner so downstream code (which keys on `user.role`
 * and `user.email`) is identical to the cookie-session path.
 *
 * Returns null when the underlying helper_assignment has been revoked —
 * the token must die with its assignment.
 */
function buildBearerUser(resolved: {
  tokenId: string;
  ownerId: string;
  userId: string;
}): import('$lib/server/auth').AuthenticatedUser | null {
  try {
    const userRow = db
      .select({ email: users.email, isSuperadmin: users.isSuperadmin })
      .from(users)
      .where(eq(users.id, resolved.userId))
      .get();
    if (!userRow) return null;
    const assignment = db
      .select({ roleWithinOwner: helperAssignments.roleWithinOwner })
      .from(helperAssignments)
      .where(
        and(
          eq(helperAssignments.userId, resolved.userId),
          eq(helperAssignments.ownerId, resolved.ownerId),
          eq(helperAssignments.status, 'active')
        )
      )
      .get();
    if (!assignment) return null;
    return {
      id: resolved.userId,
      email: userRow.email,
      role: assignment.roleWithinOwner as SessionRole,
      activeOwnerId: resolved.ownerId,
      isSuperadmin: userRow.isSuperadmin,
      impersonating: false
    };
  } catch (err) {
    console.error('[bearer-auth] failed to build user from token', err);
    return null;
  }
}

function pickRedirectForPartialSession(userId: string): string {
  try {
    const assignments = activeAssignmentsForUser(userId);
    if (assignments.length === 0) return '/onboarding';
    return '/owner-picker';
  } catch (err) {
    console.error('[tenant] failed to look up helper assignments', err);
    return '/onboarding';
  }
}

function ownerBillingStatus(ownerId: string): string | null {
  try {
    const row = db.select().from(owners).where(eq(owners.id, ownerId)).get();
    return row?.billingStatus ?? null;
  } catch {
    return null;
  }
}
