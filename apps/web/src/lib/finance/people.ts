/** How a person is named on money pages and the CSV: never a full email or
 *  phone number (F0-12). Mirrors `memberName` in `lib/tasks/assignee.ts`. */
export function personName(u: {
  email: string | null;
  phone: string | null;
  displayName?: string | null;
}): string {
  const display = u.displayName?.trim();
  if (display) return display;
  const local = u.email?.split('@')[0]?.trim();
  if (local) return local;
  const digits = (u.phone ?? '').replace(/\D/g, '');
  if (digits.length >= 4) return `phone ending ${digits.slice(-4)}`;
  return 'Someone on the farm';
}
