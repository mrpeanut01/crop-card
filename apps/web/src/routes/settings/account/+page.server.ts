/**
 * Phase 25c (#88) — /settings/account loader + actions.
 *
 * The user's identity card: email, role within active Owner, active
 * Owner chip, impersonation banner if relevant. The save action persists
 * display name, time zone and display units; the profile picture uploads
 * on its own through /api/account/avatar.
 */

import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { activeAssignmentsForUser } from '$lib/db/users';
import { avatarUrl, avatarVersion, prefsFor, updateProfile } from '$lib/db/userProfile';
import { changeOwnerZone } from '$lib/server/holdGuard';
import {
  DEFAULT_TIME_ZONE,
  normalizeDisplayName,
  normalizeDisplayUnits,
  normalizeTimeZone
} from '$lib/profile';
import { identityName } from '$lib/identity';
import { formatInstant } from '$lib/prefs';
import { LOCALE_NAMES, enabledLocales, t } from '$lib/i18n';
import { applyLocaleChoice } from '$lib/server/localeChoice';
import { signOutEverywhere } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');
  const user = locals.user;

  const userRow = db.select().from(users).where(eq(users.id, user.id)).get();
  const activeOwner = user.activeOwnerId
    ? db.select().from(owners).where(eq(owners.id, user.activeOwnerId)).get()
    : null;

  const assignments = activeAssignmentsForUser(user.id);

  const timeZone = userRow?.timeZone ?? DEFAULT_TIME_ZONE;
  const displayUnits = userRow?.displayUnits ?? 'us';
  const prefs = { timeZone, units: displayUnits, locale: locals.locale };
  const memberSince = userRow?.createdAt
    ? formatInstant(userRow.createdAt, prefs, 'date', { day: undefined })
    : '—';
  const lastLogin = user.sessionIssuedAt
    ? formatInstant(user.sessionIssuedAt, prefs, 'datetime', { timeZoneName: 'short' })
    : '—';
  const enabled = enabledLocales();

  return {
    account: {
      id: user.id,
      email: userRow ? userRow.email : user.email,
      phone: userRow ? userRow.phone : user.phone,
      name: identityName(userRow ?? user),
      displayName: userRow?.displayName ?? '',
      timeZone,
      displayUnits,
      avatarUrl: avatarUrl(user.id, avatarVersion(user.id)),
      role: user.role,
      isSuperadmin: user.isSuperadmin === true,
      impersonating: user.impersonating === true,
      since: memberSince,
      lastLogin
    },
    activeOwner: activeOwner
      ? { id: activeOwner.id, name: activeOwner.name, slug: activeOwner.slug }
      : null,
    otherOwnerCount: Math.max(0, assignments.length - (user.activeOwnerId ? 1 : 0)),
    language:
      enabled.length > 1
        ? {
            current: locals.locale,
            choices: enabled.map((id) => ({ id, name: LOCALE_NAMES[id] }))
          }
        : null
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    if (!locals.user) throw error(401, 'sign-in required');
    if (locals.user.impersonating) throw error(403, 'not available while impersonating');
    // Sign-in email/phone change only through the verified-code flow in
    // the "Sign-in methods" section (/api/account/identity).
    const fd = await request.formData();
    const submitted = {
      name: String(fd.get('name') ?? ''),
      timeZone: String(fd.get('timeZone') ?? ''),
      displayUnits: String(fd.get('displayUnits') ?? '')
    };
    const name = normalizeDisplayName(fd.get('name'), locals.locale);
    const timeZone = normalizeTimeZone(fd.get('timeZone'), locals.locale);
    const displayUnits = normalizeDisplayUnits(fd.get('displayUnits'), locals.locale);
    if (!name.ok) return fail(400, { error: name.error, submitted });
    if (!timeZone.ok) return fail(400, { error: timeZone.error, submitted });
    if (!displayUnits.ok) return fail(400, { error: displayUnits.error, submitted });
    const userId = locals.user.id;
    const fromZone = prefsFor(userId).timeZone;
    const result = await changeOwnerZone(userId, fromZone, timeZone.value, () =>
      updateProfile(userId, {
        displayName: name.value,
        timeZone: timeZone.value,
        displayUnits: displayUnits.value
      })
    );
    if (result === 'shortens') {
      return fail(409, {
        error:
          'Your time zone is the farm’s clock for withdrawal, grazing and hay holds, and this change would end one of them earlier, or would free hours a recent hold covered, which records can still be dated into. Holds never get shorter.',
        submitted
      });
    }
    if (result === 'stale') {
      return fail(409, {
        error: t(locals.locale, 'settings.account.err.stale'),
        submitted
      });
    }
    return { ok: true };
  },

  /** F5-9. Cookie sessions only, like the other identity settings. */
  locale: async ({ request, locals, cookies }) => {
    if (!locals.user) throw error(401, 'sign-in required');
    if (locals.authVia !== 'cookie' || locals.user.impersonating) {
      throw error(403, 'not available for this session');
    }
    const fd = await request.formData();
    const choice = applyLocaleChoice({
      raw: fd.get('locale'),
      cookies,
      userId: locals.user.id,
      saveToUser: true
    });
    if (!choice) {
      return fail(400, { localeError: t(locals.locale, 'account.language.unavailable') });
    }
    locals.locale = choice;
    return { localeSaved: true };
  },

  signOutEverywhere: (event) => {
    signOutEverywhere(event);
    throw redirect(303, '/');
  }
};
