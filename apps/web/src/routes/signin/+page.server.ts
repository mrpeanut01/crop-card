import { fail, redirect, type Actions } from '@sveltejs/kit';
import { loginByEmail } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  return { user: locals.user ?? null };
};

export const actions: Actions = {
  /** Sign in with email; if the user doesn't exist, create with the desired role. */
  signin: async (event) => {
    const fd = await event.request.formData();
    const email = String(fd.get('email') ?? '').trim();
    const desired = String(fd.get('role') ?? 'helper');
    const role: 'owner' | 'helper' = desired === 'owner' ? 'owner' : 'helper';
    if (!email) return fail(400, { error: 'email required' });
    try {
      loginByEmail(event, email, role);
    } catch (e) {
      return fail(400, { error: e instanceof Error ? e.message : String(e) });
    }
    throw redirect(303, '/today');
  },
  /** One-tap demo sign-in — creates owner@cropcard.local or helper@cropcard.local. */
  demo: async (event) => {
    const fd = await event.request.formData();
    const role = (String(fd.get('role') ?? 'owner') === 'helper'
      ? 'helper'
      : 'owner') as 'owner' | 'helper';
    const email = role === 'owner' ? 'owner@cropcard.local' : 'helper@cropcard.local';
    loginByEmail(event, email, role);
    throw redirect(303, '/today');
  }
};
