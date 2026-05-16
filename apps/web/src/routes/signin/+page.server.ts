import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * /signin was the v1 sign-in surface; Phase 18 promoted the landing page
 * at `/` to host both the marketing copy and the sign-in form. Old
 * bookmarks + emailed invite links (`/signin?invite=...`) continue to
 * work via this redirect.
 */
export const load: PageServerLoad = ({ url }) => {
  const invite = url.searchParams.get('invite');
  const target = invite ? `/?invite=${encodeURIComponent(invite)}` : '/';
  throw redirect(307, target);
};
