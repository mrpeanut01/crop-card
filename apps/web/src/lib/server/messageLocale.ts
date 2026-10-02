import { DEFAULT_LOCALE, enabledLocales, isKnownLocale, type Locale } from '$lib/i18n';

/** The language an outbound message goes out in: a known locale that is
 *  switched on in `CROPCARD_LOCALES`, else English. */
export function effectiveLocale(stored: string | null | undefined): Locale {
  if (!isKnownLocale(stored)) return DEFAULT_LOCALE;
  return enabledLocales().includes(stored) ? stored : DEFAULT_LOCALE;
}

/** `{ locale }` for a message that goes out in another language, else
 *  nothing, so English messages keep their exact shape. */
export function localeField(locale: string | null | undefined): { locale?: Locale } {
  const loc = effectiveLocale(locale);
  return loc === DEFAULT_LOCALE ? {} : { locale: loc };
}
