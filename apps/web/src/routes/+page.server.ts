import { fail, redirect, type Actions } from '@sveltejs/kit';
import { loginByEmail } from '$lib/server/auth';
import { ALL_SESSION_ROLES, type SessionRole } from '$lib/server/session';
import type { PageServerLoad } from './$types';

/**
 * Landing page (`/`) — public entry. Authenticated users get bounced to
 * /today so the dashboard never has to render the marketing copy. Unauth'd
 * users see the sign-in form. Form actions are wired here so the sign-in
 * POST stays on a single round-trip.
 *
 * The `?invite=<token>` query param threads through the form so a user
 * following an invite link without a session signs in here, then lands
 * back at /invite/<token> to redeem instead of /today.
 */
export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.user) {
    if (locals.user.activeOwnerId) throw redirect(307, '/today');
    // Partial session (post-signin, pre-picker/onboarding) — let
    // hooks.server.ts route us; for safety, push to /owner-picker.
    throw redirect(307, '/owner-picker');
  }
  return {
    inviteToken: url.searchParams.get('invite') ?? null
  };
};

function coerceRole(input: unknown): SessionRole {
  const s = String(input ?? 'helper');
  return (ALL_SESSION_ROLES as readonly string[]).includes(s) ? (s as SessionRole) : 'helper';
}

const DEMO_EMAIL: Record<SessionRole, string> = {
  owner: 'owner@cropcard.local',
  helper: 'helper@cropcard.local',
  inspector: 'inspector@cropcard.local',
  'custom-operator': 'custom-operator@cropcard.local'
};

/** Compute the post-auth redirect target. Honors `?invite=<token>` so the
 *  invite flow round-trips through sign-in cleanly. */
function nextForLogin(result: ReturnType<typeof loginByEmail>, inviteToken: string | null): string {
  if (inviteToken) return `/invite/${encodeURIComponent(inviteToken)}`;
  switch (result.next) {
    case 'onboarding':
      return '/onboarding';
    case 'picker':
      return '/owner-picker';
    case 'today':
    default:
      return '/today';
  }
}

export const actions: Actions = {
  signin: async (event) => {
    const fd = await event.request.formData();
    const email = String(fd.get('email') ?? '').trim();
    const inviteToken = String(fd.get('invite') ?? '') || null;
    if (!email) return fail(400, { error: 'email required', inviteToken });
    let result;
    try {
      result = loginByEmail(event, email, 'helper');
    } catch (e) {
      return fail(400, {
        error: e instanceof Error ? e.message : String(e),
        inviteToken
      });
    }
    throw redirect(303, nextForLogin(result, inviteToken));
  },
  demo: async (event) => {
    const fd = await event.request.formData();
    const role = coerceRole(fd.get('role'));
    const inviteToken = String(fd.get('invite') ?? '') || null;
    const result = loginByEmail(event, DEMO_EMAIL[role], role);
    throw redirect(303, nextForLogin(result, inviteToken));
  }
};
