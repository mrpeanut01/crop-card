import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { loginByEmail } from '$lib/server/adminAuth';

/** If already signed in, skip the form. */
export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.admin) {
    throw redirect(303, url.searchParams.get('next') ?? '/admin');
  }
  return {};
};

export const actions: Actions = {
  login: async ({ request, url }) => {
    const data = await request.formData();
    const email = String(data.get('email') ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return fail(400, { error: 'invalid email' });
    }
    const result = await loginByEmail({ email, origin: url.origin });
    return { sent: true, hint: result.loginUrl ? `(dev: ${result.loginUrl})` : undefined };
  }
};
