/**
 * The language an outbound message (push, email, SMS) goes out in. A stored
 * `users.locale` counts only while that locale is switched on in
 * `CROPCARD_LOCALES`; anything else, including no stored choice, is English.
 */

import { inArray } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { DEFAULT_LOCALE, enabledLocales, type Locale } from '$lib/i18n';
import { effectiveLocale } from './messageLocale';

export { effectiveLocale };

/** Each user's message language, read in one query. Unknown ids are English. */
export function recipientLocales(userIds: readonly string[]): Map<string, Locale> {
  const out = new Map<string, Locale>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, DEFAULT_LOCALE);
  if (enabledLocales().length === 1) return out;
  const rows = db
    .select({ id: users.id, locale: users.locale })
    .from(users)
    .where(inArray(users.id, ids))
    .all();
  for (const r of rows) out.set(r.id, effectiveLocale(r.locale));
  return out;
}

export function recipientLocale(userId: string): Locale {
  return recipientLocales([userId]).get(userId) ?? DEFAULT_LOCALE;
}
