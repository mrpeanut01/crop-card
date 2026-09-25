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

export const HOUR_MS = 60 * 60 * 1000;
export const LOCK_WINDOW_MS = 48 * HOUR_MS;
/** Notify when a record locks within this lead time. */
export const LOCK_WARNING_LEAD_MS = 2 * HOUR_MS;
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

export type PushAudience = { kind: 'all' } | { kind: 'owners-and'; userIds: string[] };

export interface PushAlert {
  kind: PushAlertKind;
  subjectId: string;
  title: string;
  body: string;
  url: string;
  audience: PushAudience;
}

const RECORD_LABEL: Record<LockableRecordKind, string> = {
  spray: 'Herbicide spray',
  insecticide: 'Insecticide',
  fungicide: 'Fungicide'
};

export function deconDueAlerts(sprayers: SprayerSnapshot[], now: number): PushAlert[] {
  const out: PushAlert[] = [];
  for (const s of sprayers) {
    if (!s.lastChemistryClass || !s.lastSprayedAt) continue;
    if (s.lastDeconAt && s.lastDeconAt >= s.lastSprayedAt) continue;
    const age = now - s.lastSprayedAt;
    if (age < DECON_GRACE_MS || age > DECON_MAX_AGE_MS) continue;
    out.push({
      kind: 'decon-due',
      subjectId: `${s.id}:${s.lastSprayedAt}`,
      title: `Decon due · ${s.label}`,
      body: `${s.label} still carries ${s.lastChemistryClass}. Run the decon wizard before the next load.`,
      url: `/spray/decon?sprayer=${encodeURIComponent(s.id)}`,
      audience: { kind: 'all' }
    });
  }
  return out;
}

export function lockWindowClosingAlerts(
  records: LockableRecordSnapshot[],
  now: number
): PushAlert[] {
  const out: PushAlert[] = [];
  for (const r of records) {
    if (r.lockedAt) continue;
    const locksAt = r.occurredAt + LOCK_WINDOW_MS;
    const remaining = locksAt - now;
    if (remaining <= 0 || remaining > LOCK_WARNING_LEAD_MS) continue;
    const minutes = Math.max(1, Math.round(remaining / 60_000));
    const when = minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes} min`;
    const where = r.blockName ? ` on ${r.blockName}` : '';
    out.push({
      kind: 'lock-window-closing',
      subjectId: `${r.kind}:${r.id}`,
      title: `${RECORD_LABEL[r.kind]} record locks in ${when}`,
      body: `The ${RECORD_LABEL[r.kind].toLowerCase()} record${where} becomes read-only (FR-09). Check it now if anything needs correcting.`,
      url: `/records/${r.kind}/${encodeURIComponent(r.id)}`,
      audience: { kind: 'owners-and', userIds: [r.performedById] }
    });
  }
  return out;
}

export function springCalibrationAlerts(sprayers: SprayerSnapshot[], now: number): PushAlert[] {
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
      title: `Recalibrate ${s.label}`,
      body: `${s.label} was winterized and has no calibration on file. Run the 1/128-acre calibration before the first spring spray.`,
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
}): PushAlert[] {
  return [
    ...deconDueAlerts(input.sprayers, input.now),
    ...lockWindowClosingAlerts(input.records, input.now),
    ...springCalibrationAlerts(input.sprayers, input.now)
  ];
}
