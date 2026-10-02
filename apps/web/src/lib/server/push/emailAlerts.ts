/**
 * The email channel for scheduled field alerts. Opt-in only: a user gets an
 * alert by email only with a consent row for that alert kind on this Owner,
 * a known email address that the provider has not reported as unsubscribed
 * or bouncing, and the same audience rules as push.
 *
 * `sendAlertEmails` must run inside the Owner's tenant context.
 */

import { inArray } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { listOptedIn } from '$lib/db/emailAlertConsents';
import { isEmailSuppressed } from '$lib/db/contactSuppressions';
import type { EmailAlertCategory } from '$lib/email/alertCategories';
import { dispatchEmail, PINGRAM_TYPE } from '$lib/server/email';
import { unsubscribeLinks } from '$lib/server/emailUnsubscribe';
import { DEFAULT_LOCALE, type Locale } from '$lib/i18n';
import { recipientLocales } from '$lib/server/recipientLocale';
import { localeField } from '$lib/server/messageLocale';
import type { MemberRole } from './dispatch';
import { inAudience, type PushAlert } from './triggers';

export interface EmailRecipient {
  userId: string;
  email: string;
}

export interface ConsentKey {
  userId: string;
  category: EmailAlertCategory;
}

/** Pure recipient selection. Anything short of an explicit opt-in for this
 *  exact alert kind means no email. */
export function selectEmailRecipients(input: {
  members: MemberRole[];
  emails: Map<string, string | null>;
  consents: ConsentKey[];
  isSuppressed: (email: string) => boolean;
  alert: Pick<PushAlert, 'kind' | 'audience'>;
}): EmailRecipient[] {
  const consented = new Set(
    input.consents.filter((c) => c.category === input.alert.kind).map((c) => c.userId)
  );
  const out: EmailRecipient[] = [];
  for (const m of input.members) {
    if (m.status !== 'active' || m.roleWithinOwner === 'inspector') continue;
    if (!consented.has(m.userId)) continue;
    const email = input.emails.get(m.userId);
    if (!email) continue;
    if (input.isSuppressed(email)) continue;
    if (!inAudience(input.alert.audience, m.userId, m.roleWithinOwner)) continue;
    out.push({ userId: m.userId, email });
  }
  return out;
}

export function emailsForUsers(userIds: string[]): Map<string, string | null> {
  if (userIds.length === 0) return new Map();
  const rows = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, userIds))
    .all();
  return new Map(rows.map((r) => [r.id, r.email]));
}

/** Email alerts need a real transport and a configured public origin for
 *  the unsubscribe links. Returns that origin, or null when email alerts
 *  are off. */
export function emailAlertOrigin(env: Record<string, string | undefined>): string | null {
  if (env.EMAIL_ALERTS === 'off') return null;
  const transport = env.EMAIL_TRANSPORT ?? 'stdout';
  if (transport === 'none') return null;
  const origin = env.ORIGIN?.trim();
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export interface EmailAlertSummary {
  sent: number;
  failed: number;
}

export interface AlertEmailLocales {
  /** Message language per user; read here when absent. */
  localeOf?: Map<string, Locale>;
  /** The alert in another language; English uses `alert` itself. */
  alertIn?: (locale: Locale) => PushAlert;
}

export async function sendAlertEmails(
  ownerId: string,
  farmName: string,
  alert: PushAlert,
  members: MemberRole[],
  origin: string,
  locales: AlertEmailLocales = {}
): Promise<EmailAlertSummary> {
  const summary: EmailAlertSummary = { sent: 0, failed: 0 };
  const consents = listOptedIn();
  if (!consents.some((c) => c.category === alert.kind)) return summary;
  const recipients = selectEmailRecipients({
    members,
    emails: emailsForUsers(members.map((m) => m.userId)),
    consents,
    isSuppressed: (email) => isEmailSuppressed(email, PINGRAM_TYPE['field-alert']),
    alert
  });
  if (recipients.length === 0) return summary;
  const localeOf = locales.localeOf ?? recipientLocales(recipients.map((r) => r.userId));
  for (const r of recipients) {
    const locale = localeOf.get(r.userId) ?? DEFAULT_LOCALE;
    const message = locale === DEFAULT_LOCALE || !locales.alertIn ? alert : locales.alertIn(locale);
    try {
      await dispatchEmail({
        kind: 'field-alert',
        to: r.email,
        category: alert.kind,
        farmName,
        title: message.title,
        body: message.body,
        actionUrl: new URL(message.url, origin).toString(),
        settingsUrl: new URL('/settings/notifications', origin).toString(),
        unsubscribe: unsubscribeLinks(origin, { userId: r.userId, ownerId, scope: alert.kind }),
        ...localeField(locale)
      });
      summary.sent++;
    } catch (err) {
      summary.failed++;
      console.warn(
        `[email-alerts] send failed user=${r.userId} kind=${alert.kind}`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return summary;
}
