/**
 * The one place consent for alert email changes: Settings, the unsubscribe
 * page, the RFC 8058 one-click POST and the Pingram webhook all come here.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { runWithTenant, unscopedQueryNote } from '$lib/db/tenant';
import {
  getEmailPrefsForUser,
  optIn,
  optOut,
  optOutAll,
  type ConsentSource
} from '$lib/db/emailAlertConsents';
import { clearEmailUnsubscribe } from '$lib/db/contactSuppressions';
import {
  EMAIL_ALERT_CATEGORIES,
  type EmailAlertCategory,
  type EmailAlertPrefs
} from '$lib/email/alertCategories';
import type { UnsubscribeClaims } from './emailUnsubscribe';

export function requestIp(event: Pick<RequestEvent, 'getClientAddress'>): string | null {
  try {
    return event.getClientAddress();
  } catch {
    return null;
  }
}

/** Change one category for the signed-in user on the active Owner. Caller
 *  is inside the request's tenant context. */
export function setEmailAlertPref(input: {
  userId: string;
  email: string | null;
  category: EmailAlertCategory;
  enabled: boolean;
  ip: string | null;
}): EmailAlertPrefs {
  if (input.enabled) {
    optIn(input.userId, input.category, { source: 'settings', ip: input.ip });
    if (input.email) clearEmailUnsubscribe(input.email);
  } else {
    optOut(input.userId, input.category, { source: 'settings' });
  }
  return getEmailPrefsForUser(input.userId);
}

export interface UnsubscribeContext {
  farmName: string | null;
  isMember: boolean;
  prefs: EmailAlertPrefs;
}

export function farmNameForOwner(ownerId: string): string | null {
  unscopedQueryNote('unsubscribe page names the farm from a signed token without a session');
  return (
    db.select({ name: owners.name }).from(owners).where(eq(owners.id, ownerId)).get()?.name ?? null
  );
}

function isActiveMember(ownerId: string, userId: string): boolean {
  unscopedQueryNote('unsubscribe page checks the signed token user still belongs to the farm');
  const row = db
    .select({ role: helperAssignments.roleWithinOwner, status: helperAssignments.status })
    .from(helperAssignments)
    .where(and(eq(helperAssignments.ownerId, ownerId), eq(helperAssignments.userId, userId)))
    .get();
  return !!row && row.status === 'active' && row.role !== 'inspector';
}

function userEmail(userId: string): string | null {
  return (
    db.select({ email: users.email }).from(users).where(eq(users.id, userId)).get()?.email ?? null
  );
}

export function unsubscribeContext(claims: UnsubscribeClaims): UnsubscribeContext {
  return {
    farmName: farmNameForOwner(claims.ownerId),
    isMember: isActiveMember(claims.ownerId, claims.userId),
    prefs: runWithTenant(claims.ownerId, () => getEmailPrefsForUser(claims.userId))
  };
}

/** Turn off what the token names (or everything, when `all` is asked for).
 *  Idempotent; returns the categories that were on and are now off. */
export function applyUnsubscribe(
  claims: UnsubscribeClaims,
  source: ConsentSource,
  opts: { everything?: boolean } = {}
): EmailAlertCategory[] {
  return runWithTenant(claims.ownerId, () => {
    if (claims.scope === 'all' || opts.everything) {
      return optOutAll(claims.userId, { source });
    }
    return optOut(claims.userId, claims.scope, { source }) ? [claims.scope] : [];
  });
}

/** Turn categories back on from the unsubscribe page. Only categories the
 *  token covers, and only while the person still belongs to the farm. */
export function applyResubscribe(
  claims: UnsubscribeClaims,
  requested: string[],
  ip: string | null
): EmailAlertCategory[] {
  if (!isActiveMember(claims.ownerId, claims.userId)) return [];
  const allowed = EMAIL_ALERT_CATEGORIES.filter(
    (c) => requested.includes(c) && (claims.scope === 'all' || claims.scope === c)
  );
  if (allowed.length === 0 && claims.scope !== 'all') allowed.push(claims.scope);
  runWithTenant(claims.ownerId, () => {
    for (const c of allowed) optIn(claims.userId, c, { source: 'unsubscribe-page', ip });
  });
  const email = userEmail(claims.userId);
  if (email && allowed.length > 0) clearEmailUnsubscribe(email);
  return allowed;
}
