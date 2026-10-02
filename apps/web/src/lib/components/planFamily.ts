import { DEFAULT_LOCALE, isKnownLocale, t, type MessageKey } from '$lib/i18n';

/** A crop family code shown in planning chrome. English keeps `english`
 *  (the text the component showed before translation); other locales get
 *  the catalog's family name, or the code when the catalog has none. */
export function planFamilyText(
  family: string,
  locale: string | null | undefined,
  english: string = family
): string {
  if (!isKnownLocale(locale) || locale === DEFAULT_LOCALE) return english;
  const key = `planui.fam.${family}` as MessageKey;
  const hit = t(locale, key);
  return hit === key ? english : hit;
}
