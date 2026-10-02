import { page } from '$app/state';
import { t, type MessageParams, type TranslateKey } from '$lib/i18n';

/** Translate for the page's active locale from code that is not a component
 *  template. Reads `page.data.locale` at call time, so a call made inside a
 *  template still tracks the locale. */
export function wt(key: TranslateKey, params?: MessageParams): string {
  let locale: string | null | undefined;
  try {
    locale = page.data?.locale;
  } catch {
    locale = undefined;
  }
  return t(locale, key, params);
}
