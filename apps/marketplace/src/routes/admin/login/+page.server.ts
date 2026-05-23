import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';

/**
 * Stub action. Sub-task C replaces this with `loginByEmail()` from
 * lib/server/adminAuth.ts (writes a row to admin_login_tokens and emails
 * the magic link via lib/server/email.ts).
 */
export const actions: Actions = {
  login: async ({ request }) => {
    const data = await request.formData();
    const email = String(data.get('email') ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return fail(400, { error: 'invalid email' });
    }
    console.log(`[admin/login stub] would issue magic-link for ${email}`);
    return { sent: true };
  }
};
