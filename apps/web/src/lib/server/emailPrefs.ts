/**
 * The one place consent for alert email changes: Settings, the unsubscribe
 * page, the RFC 8058 one-click POST and the Pingram webhook all come here.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { helperAssignments, owners } from '$lib/db/schema';
import { runWithTenant, unscopedQueryNote } from '$lib/db/tenant';
import {
  getEmailPrefsForUser,
  linkOptOutsSince,
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

/** How long after unsubscribing from a link the same link may undo it. */
export const RESUBSCRIBE_UNDO_MS = 15 * 60_000;

export type ResubscribeResult =
  | { ok: true; turnedOn: EmailAlertCategory[] }
  | { ok: false; reason: 'not-member' | 'nothing-requested' | 'window-closed' };

/** Undo an unsubscribe from the same link. The link needs no sign-in and
 *  never expires, so it may only restore what it turned off in the last few
 *  minutes; anything else needs Settings, Notifications while signed in. A
 *  provider-reported unsubscribe is never cleared from here. */
export function applyResubscribe(
  claims: UnsubscribeClaims,
  requested: string[],
  ip: string | null,
  now = Date.now()
): ResubscribeResult {
  if (!isActiveMember(claims.ownerId, claims.userId)) return { ok: false, reason: 'not-member' };
  const wanted = EMAIL_ALERT_CATEGORIES.filter(
    (c) => requested.includes(c) && (claims.scope === 'all' || claims.scope === c)
  );
  if (wanted.length === 0) return { ok: false, reason: 'nothing-requested' };
  return runWithTenant(claims.ownerId, () => {
    const undoable = new Set(linkOptOutsSince(claims.userId, now - RESUBSCRIBE_UNDO_MS));
    const turnedOn = wanted.filter((c) => undoable.has(c));
    if (turnedOn.length === 0) return { ok: false as const, reason: 'window-closed' as const };
    for (const c of turnedOn) optIn(claims.userId, c, { source: 'unsubscribe-page', ip });
    return { ok: true as const, turnedOn };
  });
}
