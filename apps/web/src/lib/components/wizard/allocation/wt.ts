import { page } from '$app/state';
import { t, type MessageParams, type TranslateKey } from '$lib/i18n';

/** The page's active locale, read at call time; undefined outside a page. */
export function wlocale(): string | undefined {
  try {
    return page.data?.locale;
  } catch {
    return undefined;
  }
}

/** Translate for the page's active locale from code that is not a component
 *  template. Reads `page.data.locale` at call time, so a call made inside a
 *  template still tracks the locale. */
export function wt(key: TranslateKey, params?: MessageParams): string {
  return t(wlocale(), key, params);
}
