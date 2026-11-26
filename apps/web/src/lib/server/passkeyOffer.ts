import type { Cookies } from '@sveltejs/kit';
import { isDemoEmail } from '$lib/demo/identity';
import { realNow } from './clock';

/** P38-5: a passkey may be added only this soon after an email, SMS or
 *  passkey sign-in (`SessionPayload.iat`, which re-mints keep). */
export const PASSKEY_ADD_WINDOW_MS = 10 * 60_000;

/** How long after an email or SMS sign-in the add-a-passkey card may show
 *  (Phase 38, P38-6). Its own module so `auth.ts` can set it without
 *  importing the WebAuthn code. */
export const OFFER_TTL_MS = PASSKEY_ADD_WINDOW_MS;
export const OFFER_COOKIE = 'cc_pk_offer';

export function markPasskeyOffer(cookies: Cookies): void {
  cookies.set(OFFER_COOKIE, '1', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.floor(OFFER_TTL_MS / 1000)
  });
}

export function clearPasskeyOffer(cookies: Cookies): void {
  cookies.delete(OFFER_COOKIE, { path: '/' });
}

export function hasPasskeyOffer(cookies: Cookies): boolean {
  return cookies.get(OFFER_COOKIE) === '1';
}

export type AddRefusal = 'demo' | 'stale';

export interface PasskeyOwner {
  id: string;
  email: string | null;
  phone: string | null;
  sessionIssuedAt?: number;
}

/** P38-5 and P38-8. Bearer and impersonation are refused earlier, by
 *  `requireInteractiveUser`. */
export function addRefusal(user: PasskeyOwner, now = realNow()): AddRefusal | null {
  if (isDemoEmail(user.email)) return 'demo';
  const iat = user.sessionIssuedAt ?? 0;
  if (!(iat > 0) || now - iat > PASSKEY_ADD_WINDOW_MS || iat > now + 60_000) return 'stale';
  return null;
}
