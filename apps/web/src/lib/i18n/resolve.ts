import { DEFAULT_LOCALE, isKnownLocale, type Locale } from './locales';

export const LOCALE_COOKIE = 'cc_locale';

/** `Accept-Language` as primary language subtags, best first. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  const entries: Array<{ tag: string; q: number; i: number }> = [];
  header.split(',').forEach((part, i) => {
    const [range, ...params] = part.trim().split(';');
    const tag = range.trim().toLowerCase();
    if (!tag || tag === '*') return;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) q = Number(m[1]);
    }
    if (!Number.isFinite(q) || q <= 0) return;
    entries.push({ tag: tag.split('-')[0], q, i });
  });
  entries.sort((a, b) => b.q - a.q || a.i - b.i);
  return entries.map((e) => e.tag);
}

/** F5-3: the user's saved choice, then the cookie, then the browser's best
 *  listed match, then English. Only enabled locales count at every step,
 *  and with English alone nothing else is read. */
export function resolveLocale(input: {
  enabled: readonly Locale[];
  userLocale?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  const { enabled } = input;
  if (enabled.length <= 1) return DEFAULT_LOCALE;
  const listed = (v: string | null | undefined): Locale | null => {
    const code = v?.trim().toLowerCase();
    return isKnownLocale(code) && enabled.includes(code) ? code : null;
  };
  return (
    listed(input.userLocale) ??
    listed(input.cookie) ??
    parseAcceptLanguage(input.acceptLanguage)
      .map(listed)
      .find((l): l is Locale => l !== null) ??
    DEFAULT_LOCALE
  );
}

/** Fill `<html lang="%lang%">` in the page shell. */
export function fillHtmlLang(html: string, locale: string): string {
  return html.replace(
    '<html lang="%lang%"',
    `<html lang="${isKnownLocale(locale) ? locale : DEFAULT_LOCALE}"`
  );
}
