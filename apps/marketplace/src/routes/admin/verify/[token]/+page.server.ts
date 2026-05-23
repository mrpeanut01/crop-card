import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { redeemLoginToken } from '$lib/server/adminAuth';
import { writeAdminSession } from '$lib/server/adminSession';

/**
 * Magic-link landing page. Loader does the redemption + cookie-write
 * then redirects to /admin. SvelteKit's load() runs server-side on
 * navigation, so the Set-Cookie header is delivered before the redirect.
 */
export const load: PageServerLoad = async ({ params, cookies }) => {
  const token = params.token;
  const redeemed = redeemLoginToken(token);
  if (!redeemed) {
    throw error(
      400,
      'sign-in link is invalid, expired, or already used — request a new one from /admin/login'
    );
  }
  writeAdminSession(cookies, { adminUserId: redeemed.adminUserId, email: redeemed.email });
  throw redirect(303, '/admin');
};
