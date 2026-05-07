import { fail, redirect, type Actions } from '@sveltejs/kit';
import { loginByEmail } from '$lib/server/auth';
import { ALL_SESSION_ROLES, type SessionRole } from '$lib/server/session';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  return { user: locals.user ?? null };
};

function coerceRole(input: unknown): SessionRole {
  const s = String(input ?? 'helper');
  return (ALL_SESSION_ROLES as readonly string[]).includes(s)
    ? (s as SessionRole)
    : 'helper';
}

const DEMO_EMAIL: Record<SessionRole, string> = {
  owner: 'owner@cropcard.local',
  helper: 'helper@cropcard.local',
  inspector: 'inspector@cropcard.local',
  'custom-operator': 'custom-operator@cropcard.local'
};

export const actions: Actions = {
  /** Sign in with email; if the user doesn't exist, create with the desired role. */
  signin: async (event) => {
    const fd = await event.request.formData();
    const email = String(fd.get('email') ?? '').trim();
    const role = coerceRole(fd.get('role'));
    if (!email) return fail(400, { error: 'email required' });
    try {
      loginByEmail(event, email, role);
    } catch (e) {
      return fail(400, { error: e instanceof Error ? e.message : String(e) });
    }
    throw redirect(303, '/today');
  },
  /** One-tap demo sign-in for any of the four roles. */
  demo: async (event) => {
    const fd = await event.request.formData();
    const role = coerceRole(fd.get('role'));
    loginByEmail(event, DEMO_EMAIL[role], role);
    throw redirect(303, '/today');
  }
};
