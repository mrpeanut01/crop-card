import { t } from '$lib/i18n';

/** How a person is named on money pages and the CSV: never a full email or
 *  phone number (F0-12). Mirrors `memberName` in `lib/tasks/assignee.ts`.
 *  The CSV passes no locale, so it stays English. */
export function personName(
  u: {
    email: string | null;
    phone: string | null;
    displayName?: string | null;
  },
  locale?: string | null
): string {
  const display = u.displayName?.trim();
  if (display) return display;
  const local = u.email?.split('@')[0]?.trim();
  if (local) return local;
  const digits = (u.phone ?? '').replace(/\D/g, '');
  if (digits.length >= 4) {
    if (!locale) return `phone ending ${digits.slice(-4)}`;
    return t(locale, 'finance.people.phoneEnding', { digits: digits.slice(-4) });
  }
  if (!locale) return 'Someone on the farm';
  return t(locale, 'finance.people.someone');
}
