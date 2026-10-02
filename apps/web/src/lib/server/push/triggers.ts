/**
 * NFR-06 — pure alert selection for scheduled push notifications.
 *
 * Given one Owner's sprayer + record snapshot and `now`, returns the alerts
 * that are currently due. Each alert carries a stable `subjectId`; the
 * sent-log (`push_deliveries`) keys on (owner, kind, subjectId) so repeated
 * ticks never re-send. Informational only — the kernel and the FR-09 server
 * lock stay the enforcement points.
 */

import type { PushAlertKind } from '$lib/push/prefs';
import { digestPushBody, type WeeklyDigest } from '$lib/digest/weekly';
import { t } from '$lib/i18n';

export const HOUR_MS = 60 * 60 * 1000;
export const LOCK_WINDOW_MS = 48 * HOUR_MS;
/**
 * Times (UTC, minutes past midnight) the push-tick Container Apps Jobs run.
 * 10:00 / 20:30 UTC is 06:00 / 16:30 EDT (the frost seasons) and 05:00 /
 * 15:30 EST in winter; ACA cron has no time zone, so the local time drifts an
 * hour with DST. 16:30 catches NWS frost/freeze products issued mid-to-late
 * afternoon for tonight. One cron can't express both minutes, so each time is
 * its own job.
 */
export const PUSH_TICK_TIMES_UTC = [10 * 60, 20 * 60 + 30] as const;
export const PUSH_TICK_CRONS_UTC = PUSH_TICK_TIMES_UTC.map(
  (m) => `${m % 60} ${Math.floor(m / 60)} * * *`
);
/** Longest gap between two ticks (10:00 to 20:30 is 10.5 h, 20:30 to 10:00 is 13.5 h). */
export const MAX_TICK_GAP_MS = 13.5 * HOUR_MS;
/**
 * Notify when a record locks within this lead time. Ticks run twice a day, so
 * the lead must exceed the longest gap between ticks or a record could lock
 * unannounced; 24 h leaves room for a cold start or one missed run.
 */
export const LOCK_WARNING_LEAD_MS = 24 * HOUR_MS;
/** Give the operator an hour to decon on their own before nagging. */
export const DECON_GRACE_MS = HOUR_MS;
/** Don't alert about ancient dirty tanks (e.g. on first deploy). */
export const DECON_MAX_AGE_MS = 7 * 24 * HOUR_MS;
/** Spring calibration alerts only fire from this month on (0-based: March). */
export const SPRING_START_MONTH = 2;

export interface SprayerSnapshot {
  id: string;
  label: string;
  calibratedGpa: number | null;
  lastChemistryClass?: string | null;
  lastSprayedAt?: number;
  lastDeconAt?: number;
  winterizedAt?: number;
}

export type LockableRecordKind = 'spray' | 'insecticide' | 'fungicide';

export interface LockableRecordSnapshot {
  kind: LockableRecordKind;
  id: string;
  occurredAt: number;
  lockedAt?: number | null;
  performedById: string;
  blockName?: string;
}

/** `only` reaches exactly these users; owners are not added (F4-4). */
export type PushAudience =
  { kind: 'all' } | { kind: 'owners-and'; userIds: string[] } | { kind: 'only'; userIds: string[] };

/** Whether a member with this role is inside the audience. */
export function inAudience(audience: PushAudience, userId: string, role: string): boolean {
  if (audience.kind === 'all') return true;
  if (audience.kind === 'only') return audience.userIds.includes(userId);
  return role === 'owner' || audience.userIds.includes(userId);
}

export interface PushAlert {
  kind: PushAlertKind;
  subjectId: string;
  title: string;
  body: string;
  url: string;
  audience: PushAudience;
  /** Alerts with the same key in one tick go out as one push (32D). */
  batchKey?: string;
  /** This alert's line in a batched push. */
  batchLabel?: string;
  /** The animal or group it is about, when one batch counts subjects. */
  batchSubject?: string;
}

export function deconDueAlerts(
  sprayers: SprayerSnapshot[],
  now: number,
  locale?: string | null
): PushAlert[] {
  const out: PushAlert[] = [];
  for (const s of sprayers) {
    if (!s.lastChemistryClass || !s.lastSprayedAt) continue;
    if (s.lastDeconAt && s.lastDeconAt >= s.lastSprayedAt) continue;
    const age = now - s.lastSprayedAt;
    if (age < DECON_GRACE_MS || age > DECON_MAX_AGE_MS) continue;
    out.push({
      kind: 'decon-due',
      subjectId: `${s.id}:${s.lastSprayedAt}`,
      title: t(locale, 'push.decon.title', { sprayer: s.label }),
      body: t(locale, 'push.decon.body', {
        sprayer: s.label,
        chemistry: s.lastChemistryClass
      }),
      url: `/spray/decon?sprayer=${encodeURIComponent(s.id)}`,
      audience: { kind: 'all' }
    });
  }
  return out;
}

export function lockWindowClosingAlerts(
  records: LockableRecordSnapshot[],
  now: number,
  locale?: string | null
): PushAlert[] {
  const out: PushAlert[] = [];
  for (const r of records) {
    if (r.lockedAt) continue;
    const locksAt = r.occurredAt + LOCK_WINDOW_MS;
    const remaining = locksAt - now;
    if (remaining <= 0 || remaining > LOCK_WARNING_LEAD_MS) continue;
    const minutes = Math.max(1, Math.round(remaining / 60_000));
    const when =
      minutes >= 60
        ? t(locale, 'push.lock.hours', { hours: Math.round(minutes / 60) })
        : t(locale, 'push.lock.minutes', { minutes });
    const lower = t(locale, `push.lock.recordLower.${r.kind}`);
    out.push({
      kind: 'lock-window-closing',
      subjectId: `${r.kind}:${r.id}`,
      title: t(locale, 'push.lock.title', {
        record: t(locale, `push.lock.record.${r.kind}`),
        when
      }),
      body: r.blockName
        ? t(locale, 'push.lock.bodyOn', { record: lower, block: r.blockName })
        : t(locale, 'push.lock.body', { record: lower }),
      url: `/records/${r.kind}/${encodeURIComponent(r.id)}`,
      audience: { kind: 'owners-and', userIds: [r.performedById] }
    });
  }
  return out;
}

export function springCalibrationAlerts(
  sprayers: SprayerSnapshot[],
  now: number,
  locale?: string | null
): PushAlert[] {
  const nowDate = new Date(now);
  if (nowDate.getMonth() < SPRING_START_MONTH) return [];
  const year = nowDate.getFullYear();
  const out: PushAlert[] = [];
  for (const s of sprayers) {
    if (!s.winterizedAt) continue;
    if (s.calibratedGpa != null) continue;
    if (new Date(s.winterizedAt).getFullYear() >= year) continue;
    out.push({
      kind: 'spring-calibration',
      subjectId: `${s.id}:${year}`,
      title: t(locale, 'push.spring.title', { sprayer: s.label }),
      body: t(locale, 'push.spring.body', { sprayer: s.label }),
      url: '/calibrate',
      audience: { kind: 'all' }
    });
  }
  return out;
}

export function selectDueAlerts(input: {
  sprayers: SprayerSnapshot[];
  records: LockableRecordSnapshot[];
  now: number;
  /** Recipient language; unset is English. */
  locale?: string | null;
}): PushAlert[] {
  return [
    ...deconDueAlerts(input.sprayers, input.now, input.locale),
    ...lockWindowClosingAlerts(input.records, input.now, input.locale),
    ...springCalibrationAlerts(input.sprayers, input.now, input.locale)
  ];
}

/**
 * F4-2. The Monday summary goes out on the first tick at or after Monday
 * 10:00 UTC and no later than the end of Tuesday UTC; a week missed past
 * that is skipped, never sent late.
 */
export const DIGEST_SEND_FROM_UTC_MINUTES = 10 * 60;

export function isDigestSendWindow(now: number): boolean {
  const d = new Date(now);
  const day = d.getUTCDay();
  if (day === 2) return true;
  return day === 1 && d.getUTCHours() * 60 + d.getUTCMinutes() >= DIGEST_SEND_FROM_UTC_MINUTES;
}

/** The Monday of the send, `YYYY-MM-DD` (F4-1). */
export function digestMondayYmd(now: number): string {
  const d = new Date(now);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back))
    .toISOString()
    .slice(0, 10);
}

export function digestSubjectId(userId: string, mondayYmd: string): string {
  return `${userId}:${mondayYmd}`;
}

/** One alert per person (F4-4): content differs per person, so none are
 *  batched. The body never carries money (F4-7). */
export function weeklyDigestAlerts(
  digests: ReadonlyArray<{ userId: string; digest: WeeklyDigest }>,
  locale?: string | null
): PushAlert[] {
  return digests.map(({ userId, digest }) => ({
    kind: 'weekly-digest' as const,
    subjectId: digestSubjectId(userId, digest.weekStartYmd),
    title: t(locale, 'push.digest.title'),
    body: digestPushBody(digest, locale),
    url: '/today',
    audience: { kind: 'only' as const, userIds: [userId] }
  }));
}
