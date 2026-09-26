import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import {
  formatPhone,
  parseForChannel,
  parseIdentifier,
  parseSignInChannel,
  type SignInChannel
} from '$lib/identity';
import { loginByEmail, loginByIdentity, redirectFromLogin } from '$lib/server/auth';
import {
  authMode,
  handleLoginRequest,
  isDirectLoginAllowed,
  redeemLoginCode,
  sanitizeInviteToken
} from '$lib/server/magicLink';
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
    inviteToken: url.searchParams.get('invite') ?? null,
    authMode: authMode(),
    via: (url.searchParams.get('via') === 'phone' ? 'phone' : 'email') as SignInChannel
  };
};

/** AUTH_MODE=magic-link turns off every path that mints a session from a
 *  bare email (the email form and the demo buttons). Enforced here, not
 *  just hidden in the UI. */
function assertDirectLogin(): void {
  if (!isDirectLoginAllowed()) throw error(403, 'direct sign-in is disabled; use the email link');
}

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

/** Follow the post-auth redirect. `?invite=<token>` short-circuits so the
 *  invite flow round-trips through sign-in cleanly; otherwise delegate to
 *  the canonical `redirectFromLogin` helper, which covers every LoginResult
 *  arm (including `'admin'` — #332, avoiding the /today→/admin double hop). */
function redirectNextForLogin(
  result: ReturnType<typeof loginByIdentity>,
  inviteToken: string | null
): never {
  if (inviteToken) throw redirect(303, `/invite/${encodeURIComponent(inviteToken)}`);
  redirectFromLogin(result.next);
}

export const actions: Actions = {
  signin: async (event) => {
    assertDirectLogin();
    const fd = await event.request.formData();
    const inviteToken = String(fd.get('invite') ?? '') || null;
    const raw = fd.get('identifier') ?? fd.get('email');
    const channel = parseSignInChannel(fd.get('channel'));
    let id = parseIdentifier(raw);
    if (channel) {
      const parsed = parseForChannel(raw, channel);
      if (!parsed.ok) return fail(400, { error: parsed.error, inviteToken, via: channel });
      id = parsed.id;
    }
    if (!id) return fail(400, { error: 'Enter an email address or a phone number.', inviteToken });
    let result;
    try {
      result = loginByIdentity(
        event,
        id.kind === 'email' ? { email: id.value } : { phone: id.value },
        'helper'
      );
    } catch (e) {
      return fail(400, {
        error: e instanceof Error ? e.message : String(e),
        inviteToken
      });
    }
    redirectNextForLogin(result, inviteToken);
  },
  demo: async (event) => {
    assertDirectLogin();
    const fd = await event.request.formData();
    const role = coerceRole(fd.get('role'));
    const inviteToken = String(fd.get('invite') ?? '') || null;
    const result = loginByEmail(event, DEMO_EMAIL[role], role);
    redirectNextForLogin(result, inviteToken);
  },
  /** Step 1: email → magic link + backup code; phone → SMS code. */
  magic: async (event) => {
    const fd = await event.request.formData();
    const raw = fd.get('identifier') ?? fd.get('email');
    const inviteToken = sanitizeInviteToken(fd.get('invite'));
    const channel = parseSignInChannel(fd.get('channel'));
    const entered = String(raw ?? '');
    let identifier: unknown = raw;
    if (channel) {
      const parsed = parseForChannel(raw, channel);
      if (!parsed.ok) return fail(400, { error: parsed.error, inviteToken, entered, via: channel });
      identifier = parsed.id.value;
    }
    const result = await handleLoginRequest(event, identifier, inviteToken);
    if (!result.ok) {
      return fail(result.status, {
        error: result.error,
        inviteToken,
        entered,
        via: channel ?? undefined
      });
    }
    return {
      sent: true,
      via: (result.channel === 'sms' ? 'phone' : 'email') as SignInChannel,
      channel: result.channel,
      identifier: result.identifier,
      sentTo: result.sentTo,
      message: result.message,
      inviteToken
    };
  },
  /** Step 2: the 6-digit code from the email or text. Works in both
   *  AUTH_MODEs because it proves control of the address. */
  code: async (event) => {
    const fd = await event.request.formData();
    const identifier = String(fd.get('identifier') ?? '');
    const inviteToken = sanitizeInviteToken(fd.get('invite'));
    const redeemed = redeemLoginCode(identifier, fd.get('code'));
    const id = parseIdentifier(identifier);
    if (!redeemed.ok) {
      return fail(400, {
        sent: true,
        via: (id?.kind === 'phone' ? 'phone' : 'email') as SignInChannel,
        codeError: redeemed.error,
        channel: id?.kind === 'phone' ? ('sms' as const) : ('email' as const),
        identifier,
        sentTo: id?.kind === 'phone' ? formatPhone(id.value) : identifier,
        message: '',
        inviteToken
      });
    }
    const result = loginByIdentity(event, redeemed.identity);
    redirectNextForLogin(result, inviteToken);
  }
};
