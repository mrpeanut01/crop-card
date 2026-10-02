import { createT, type MessageParams, type Translator, type TranslateKey } from '$lib/i18n';

/** Translates a line that lives in `lib/billing/plans.ts` as English text.
 *  If the English catalog entry no longer matches the line (the plans file
 *  changed), the line is shown as written rather than as a stale message. */
export function localizedLine(
  tr: Translator,
  line: string,
  key: TranslateKey,
  params?: MessageParams
): string {
  return createT('en')(key, params) === line ? tr(key, params) : line;
}
