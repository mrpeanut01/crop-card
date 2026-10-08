import { t } from '$lib/i18n';
import { intlLocale } from '$lib/prefs';
import { numberToLocaleString } from '$lib/intlCache';

/** #708: a list of names that stays short: "Bed 1, Bed 2, Bed 3 and 26 more". */
export function shortNameList(names: readonly string[], locale?: string | null, max = 3): string {
  if (names.length <= max) return names.join(', ');
  const rest = names.length - max;
  return t(locale, 'wizard.review.namesMore', {
    names: names.slice(0, max).join(', '),
    count: rest,
    n: numberToLocaleString(rest, intlLocale(locale))
  });
}
