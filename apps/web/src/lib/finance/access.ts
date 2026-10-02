/**
 * F2-1: who can reach money. Owner role only, for pages and APIs. An owner
 * Bearer token may read and write; impersonation may read and never write.
 */

import { error, type RequestEvent } from '@sveltejs/kit';
import { requireUser, type AuthenticatedUser } from '$lib/server/auth';
import { t } from '$lib/i18n';

export const MONEY_OWNER_ONLY = 'Money is only shown to the farm owner.';
export const MONEY_NO_IMPERSONATION = 'Money cannot be changed while impersonating.';

/** The refusal in the reader's language; English without a locale. */
export function moneyOwnerOnlyText(locale?: string | null): string {
  return locale ? t(locale, 'finance.access.ownerOnly') : MONEY_OWNER_ONLY;
}

export function moneyNoImpersonationText(locale?: string | null): string {
  return locale ? t(locale, 'finance.entry.impersonating') : MONEY_NO_IMPERSONATION;
}

function eventLocale(event: RequestEvent): string | null {
  return (event.locals as { locale?: string } | undefined)?.locale ?? null;
}

export function requireMoneyReader(event: RequestEvent): AuthenticatedUser {
  const user = requireUser(event);
  if (user.role !== 'owner') throw error(403, moneyOwnerOnlyText(eventLocale(event)));
  return user;
}

export function requireMoneyWriter(event: RequestEvent): AuthenticatedUser {
  const user = requireMoneyReader(event);
  if (user.impersonating) throw error(403, moneyNoImpersonationText(eventLocale(event)));
  return user;
}
