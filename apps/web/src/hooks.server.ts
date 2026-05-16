import { json, redirect, type Handle } from '@sveltejs/kit';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { activeAssignmentsForUser } from '$lib/db/users';
import { runWithTenantAsync } from '$lib/db/tenant';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Routes that don't require ANY session. Hitting these without a cookie
// renders normally; everywhere else redirects to `/` (the landing/signin).
// Keep this list tight — every new public surface is a potential
// pre-auth attack surface.
const ANONYMOUS_PATHS = new Set(['/', '/signin', '/signout', '/api/health']);
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
 * Request boundary (Phase 18 final):
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
  const user = currentUser(event);
  if (user) event.locals.user = user;
  const path = event.url.pathname;

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
