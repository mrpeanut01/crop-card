import type { Cookies } from '@sveltejs/kit';
import { setUserLocale } from '$lib/db/userProfile';
import { enabledLocales, isKnownLocale, type Locale } from '$lib/i18n/locales';
import { LOCALE_COOKIE } from '$lib/i18n/resolve';

/** The one place a language choice is validated and stored: the header
 *  toggle, the onboarding question and the account setting all call it.
 *  Returns null when the choice is not an enabled locale. The saved choice
 *  follows a signed-in user across devices; the cookie covers this one. */
export function applyLocaleChoice(input: {
  raw: unknown;
  cookies: Cookies;
  userId: string | null;
  saveToUser: boolean;
}): Locale | null {
  const choice = String(input.raw ?? '')
    .trim()
    .toLowerCase();
  const enabled = enabledLocales();
  if (enabled.length <= 1 || !isKnownLocale(choice) || !enabled.includes(choice)) return null;
  if (input.userId && input.saveToUser) setUserLocale(input.userId, choice);
  input.cookies.set(LOCALE_COOKIE, choice, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  });
  return choice;
}
