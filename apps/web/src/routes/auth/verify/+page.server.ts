import { fail, redirect, type Actions } from '@sveltejs/kit';
import { loginByEmail, redirectFromLogin } from '$lib/server/auth';
import {
  consumeMagicLink,
  handleMagicLinkRequest,
  peekMagicLink,
  sanitizeInviteToken
} from '$lib/server/magicLink';
import type { PageServerLoad } from './$types';

/**
 * GET shows a confirm button without consuming the token, so mail
 * scanners that prefetch links can't burn it. The POST redeems it and
 * mints the HMAC session through the same `loginByEmail` routing as the
 * direct sign-in (onboarding / picker / today / admin).
 */
export const load: PageServerLoad = ({ url }) => {
  const token = url.searchParams.get('token');
  const invite = sanitizeInviteToken(url.searchParams.get('invite'));
  const check = peekMagicLink(token);
  if (!check.ok) return { status: 'invalid' as const, reason: check.reason, invite };
  return { status: 'ready' as const, email: check.email, token: token as string, invite };
};

export const actions: Actions = {
  confirm: async (event) => {
    const fd = await event.request.formData();
    const invite = sanitizeInviteToken(fd.get('invite'));
    const check = consumeMagicLink(fd.get('token'));
    if (!check.ok) return fail(400, { reason: check.reason });
    const result = loginByEmail(event, check.email);
    if (invite) throw redirect(303, `/invite/${encodeURIComponent(invite)}`);
    redirectFromLogin(result.next);
  },
  resend: async (event) => {
    const fd = await event.request.formData();
    const result = await handleMagicLinkRequest(event, fd.get('email'), fd.get('invite'));
    if (!result.ok) return fail(result.status, { resendError: result.error });
    return { sent: true, message: result.message };
  }
};
