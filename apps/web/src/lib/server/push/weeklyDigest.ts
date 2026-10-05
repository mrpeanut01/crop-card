/**
 * Phase 32F F4. The Monday summary on the push tick (F4-2, F4-3). Runs inside
 * one Owner's tenant context. Recipients are re-read at send time: an active
 * assignment on this Owner with an assignable role (F0-11), and either a
 * push subscription of theirs with the kind on or a live email consent with
 * a known, unsuppressed address. Each (user, Monday) is claimed in
 * `push_deliveries` before anything is sent, so it goes out at most once.
 */

import {
  listSubscriptions,
  claimDelivery,
  setDeliveryRecipientCount
} from '$lib/db/pushSubscriptions';
import { listOptedIn } from '$lib/db/emailAlertConsents';
import { isEmailSuppressed } from '$lib/db/contactSuppressions';
import { listDigestLedger, listDigestTasks, listDigestTime, memberNames } from '$lib/db/digest';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { lowStockItems } from '$lib/db/stock';
import { farmTimeZone } from '$lib/db/userProfile';
import { buildWeeklyDigest, cashForDays, shortDay, type WeeklyDigest } from '$lib/digest/weekly';
import { buildDigestCard, digestCardText } from '$lib/cards/build/digest';
import { ASSIGNABLE_ROLES } from '$lib/tasks/assignee';
import { dispatchEmail, PINGRAM_TYPE } from '$lib/server/email';
import { unsubscribeLinks } from '$lib/server/emailUnsubscribe';
import { addDaysYmd } from '$lib/today/views';
import { selectRecipients, sendToSubscriptions, type MemberRole } from './dispatch';
import { emailsForUsers, selectEmailRecipients } from './emailAlerts';
import {
  digestMondayYmd,
  isDigestSendWindow,
  weeklyDigestAlerts,
  type PushAlert
} from './triggers';
import type { VapidConfig } from './webPush';
import { DEFAULT_LOCALE, t, type Locale } from '$lib/i18n';
import { recipientLocales } from '$lib/server/recipientLocale';
import { localeField } from '$lib/server/messageLocale';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Open tasks older than this are not "overdue" in a summary any more. */
export const DIGEST_OVERDUE_LOOKBACK_DAYS = 30;
/** Slack around the farm-local week for time zones far from UTC. */
const EDGE_MS = 2 * DAY_MS;

export interface DigestDeps {
  config: VapidConfig | null;
  emailOrigin?: string | null;
  fetchImpl?: typeof fetch;
}

export interface DigestSummary {
  alerts: number;
  sent: number;
  removed: number;
  failed: number;
  emailed: number;
  emailFailed: number;
}

const ASSIGNABLE = new Set<string>(ASSIGNABLE_ROLES);

/** Members who may get the digest at all (F0-11): active, never an inspector. */
export function digestEligible(members: readonly MemberRole[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of members) {
    if (m.status === 'active' && ASSIGNABLE.has(m.roleWithinOwner)) {
      out.set(m.userId, m.roleWithinOwner);
    }
  }
  return out;
}

export async function weeklyDigestForOwner(
  ownerId: string,
  /** Null when the farm has no name: each recipient reads "your farm". */
  farmName: string | null,
  members: readonly MemberRole[],
  now: number,
  deps: DigestDeps
): Promise<DigestSummary> {
  const summary: DigestSummary = {
    alerts: 0,
    sent: 0,
    removed: 0,
    failed: 0,
    emailed: 0,
    emailFailed: 0
  };
  if (!isDigestSendWindow(now)) return summary;

  const eligible = digestEligible(members);
  const subs = deps.config ? listSubscriptions() : [];
  const consents = deps.emailOrigin
    ? listOptedIn().filter((c) => c.category === 'weekly-digest')
    : [];
  const wanting = new Set<string>();
  for (const s of subs) if (s.prefs['weekly-digest']) wanting.add(s.userId);
  for (const c of consents) wanting.add(c.userId);
  const recipients = [...wanting].filter((id) => eligible.has(id));
  if (recipients.length === 0) return summary;

  const monday = digestMondayYmd(now);
  const anyOwnerEmail = consents.some((c) => eligible.get(c.userId) === 'owner');
  const source = loadDigestSource({
    monday,
    now,
    memberIds: [...eligible.keys()],
    withCash: anyOwnerEmail
  });
  const localeOf = recipientLocales(recipients);
  const digestFor = (userId: string, withCash: boolean, locale: Locale): WeeklyDigest =>
    source.digestFor(userId, eligible.get(userId) === 'owner', withCash, locale);

  const emails = deps.emailOrigin ? emailsForUsers(recipients) : new Map<string, string | null>();
  for (const userId of recipients) {
    const locale = localeOf.get(userId) ?? DEFAULT_LOCALE;
    const digest = digestFor(userId, false, locale);
    const [alert] = weeklyDigestAlerts([{ userId, digest }], locale);
    if (!claimDelivery(alert.kind, alert.subjectId, now)) continue;
    summary.alerts++;
    let delivered = 0;
    if (deps.config) {
      const targets = selectRecipients(subs, [...members], alert);
      if (targets.length > 0) {
        const result = await sendToSubscriptions(
          targets,
          {
            title: alert.title,
            body: alert.body,
            url: alert.url,
            tag: alert.subjectId,
            kind: alert.kind
          },
          deps.config,
          { fetchImpl: deps.fetchImpl, nowMs: now, urgency: 'normal' }
        );
        delivered += result.sent;
        summary.sent += result.sent;
        summary.removed += result.removed;
        summary.failed += result.failed;
      }
    }
    if (deps.emailOrigin) {
      const mail = await sendDigestEmail({
        ownerId,
        farmName: farmName ?? t(locale, 'email.yourFarm'),
        userId,
        alert,
        members,
        emails,
        consents,
        origin: deps.emailOrigin,
        digest: eligible.get(userId) === 'owner' ? digestFor(userId, true, locale) : digest,
        viewerName: source.people[userId] ?? null,
        now,
        locale
      });
      delivered += mail.sent;
      summary.emailed += mail.sent;
      summary.emailFailed += mail.failed;
    }
    setDeliveryRecipientCount(alert.kind, alert.subjectId, delivered);
  }
  return summary;
}

export interface DigestSource {
  timeZone: string;
  people: Record<string, string>;
  digestFor(
    userId: string,
    isOwner: boolean,
    withCash: boolean,
    locale?: string | null
  ): WeeklyDigest;
}

/**
 * Everything one farm's Monday summaries read, once per farm. Inside the
 * Owner's tenant context. `memberIds` are the people whose names may show.
 */
export function loadDigestSource(input: {
  monday: string;
  now: number;
  memberIds: readonly string[];
  withCash: boolean;
}): DigestSource {
  const { monday, now } = input;
  const timeZone = farmTimeZone();
  const weekStartMs = Date.parse(`${monday}T00:00:00Z`);
  const lastWeekMs = weekStartMs - 7 * DAY_MS;
  const tasks = listDigestTasks({
    openFromMs: weekStartMs - DIGEST_OVERDUE_LOOKBACK_DAYS * DAY_MS,
    openToMs: weekStartMs + 7 * DAY_MS + EDGE_MS,
    closedFromMs: lastWeekMs - EDGE_MS,
    closedToMs: weekStartMs + EDGE_MS
  });
  const primaries = tasks.filter((t) => t.kind === 'primary' && t.category !== 'animal-care');
  const careDue = tasks.filter(
    (t) => t.category === 'animal-care' && t.completedAt == null && t.abortedAt == null
  );
  const openPrimaries = primaries.filter((t) => t.completedAt == null && t.abortedAt == null);
  const closedPrimaries = primaries.filter((t) => t.completedAt != null || t.abortedAt != null);
  const timeEntries = listDigestTime(lastWeekMs - EDGE_MS, weekStartMs + EDGE_MS);
  const harvestsAt = listHarvestEvents({
    fromMs: lastWeekMs - EDGE_MS,
    toMs: weekStartMs + EDGE_MS
  }).map((h) => h.occurredAt);
  const lowStockCount = lowStockItems().length;
  const people = memberNames(input.memberIds);
  const cash = input.withCash
    ? cashForDays(
        listDigestLedger(lastWeekMs - EDGE_MS, weekStartMs + EDGE_MS),
        addDaysYmd(monday, -7),
        addDaysYmd(monday, -1),
        timeZone
      )
    : null;
  return {
    timeZone,
    people,
    digestFor: (userId, isOwner, withCash, locale) =>
      buildWeeklyDigest({
        viewerId: userId,
        isOwner,
        weekStartYmd: monday,
        timeZone,
        nowMs: now,
        openTasks: openPrimaries,
        careDue,
        closedTasks: closedPrimaries,
        timeEntries,
        harvestsAt,
        lowStockCount,
        people,
        cash: isOwner && withCash ? cash : null,
        locale
      })
  };
}

async function sendDigestEmail(input: {
  ownerId: string;
  farmName: string;
  userId: string;
  alert: PushAlert;
  members: readonly MemberRole[];
  emails: Map<string, string | null>;
  consents: { userId: string; category: 'weekly-digest' | string }[];
  origin: string;
  digest: WeeklyDigest;
  viewerName: string | null;
  now: number;
  locale?: Locale;
}): Promise<{ sent: number; failed: number }> {
  const [r] = selectEmailRecipients({
    members: [...input.members],
    emails: input.emails,
    consents: input.consents
      .filter((c) => c.category === 'weekly-digest')
      .map((c) => ({ userId: c.userId, category: 'weekly-digest' as const })),
    isSuppressed: (email) => isEmailSuppressed(email, PINGRAM_TYPE['weekly-digest']),
    alert: input.alert
  });
  if (!r) return { sent: 0, failed: 0 };
  const card = buildDigestCard(input.digest, {
    asOf: input.now,
    farmName: input.farmName,
    viewerName: input.viewerName,
    locale: input.locale
  });
  try {
    await dispatchEmail({
      kind: 'weekly-digest',
      to: r.email,
      farmName: input.farmName,
      weekOf: shortDay(input.digest.weekStartYmd, input.locale),
      body: digestCardText(card),
      actionUrl: new URL('/today', input.origin).toString(),
      settingsUrl: new URL('/settings/notifications', input.origin).toString(),
      unsubscribe: unsubscribeLinks(input.origin, {
        userId: r.userId,
        ownerId: input.ownerId,
        scope: 'weekly-digest'
      }),
      ...localeField(input.locale)
    });
    return { sent: 1, failed: 0 };
  } catch (err) {
    console.warn(
      `[digest] email failed user=${r.userId}`,
      err instanceof Error ? err.message : err
    );
    return { sent: 0, failed: 1 };
  }
}
