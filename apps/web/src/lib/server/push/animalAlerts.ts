/**
 * Phase 32D animal alerts (D1). Pure selection, like `triggers.ts`:
 *
 * - `animal-care-due`: one reminder on the day a care task surfaces (its
 *   lead days before the due day) and one on the day it is due if it is
 *   still open (D2-10). A snooze asks for one more on the new day. Every
 *   member of the farm who is not an inspector gets it (D0-16).
 * - `withdrawal-clears`: a food hold on an animal or group ended since the
 *   last tick. Owner only, off by default, informational. Sent only after
 *   the hold's local-midnight end has passed, never before.
 * - `hold-covers-sale` (G3): a later write lengthened a hold over egg or
 *   milk logs saved as food or for sale, or over meat declared as food.
 *   Read from the ledger's covered set at the tick, so any lengthening
 *   counts; each record is pushed once. Owner only, on by default.
 *
 * Lock-screen and email text names the animal or group and the care kind
 * only, never a product or hold detail. Several alerts of one kind in the
 * same tick go out as one push (`batchKey`).
 */

import {
  daysBetween,
  isSurfaced,
  type CarePlanKind,
  type CareTaskMeta
} from '$lib/animals/carePlans';
import { t } from '$lib/i18n';
import {
  splitHoldMapKey,
  type HoldFact,
  type HoldProjection,
  type Span
} from '$lib/safety/holdLedger';
import { HOUR_MS, type PushAlert } from './triggers';

export interface OpenCareTask {
  meta: CareTaskMeta;
  /** The task's day (`YYYY-MM-DD`): the due day, or later after a snooze. */
  scheduledOn: string;
  /** Null when the animal or group is gone; the alert says "An animal". */
  subjectName: string | null;
}

function careLabel(kind: CarePlanKind, locale?: string | null): string {
  return t(locale, `animals.careKind.${kind}`);
}

/** The lock-screen text for one care reminder: the animal or group and
 *  the care kind only. */
export function careAlertTextFor(
  kind: CarePlanKind,
  subjectName: string,
  when: 'soon' | 'due',
  daysAway: number,
  locale?: string | null
): { title: string; body: string } {
  const p = { label: careLabel(kind, locale), name: subjectName };
  if (when === 'due') {
    return { title: t(locale, 'push.care.dueTitle', p), body: t(locale, 'push.care.dueBody', p) };
  }
  return {
    title: t(locale, 'push.care.soonTitle', p),
    body:
      daysAway === 1
        ? t(locale, 'push.care.soonBodyTomorrow', p)
        : t(locale, 'push.care.soonBodyDays', { ...p, days: daysAway })
  };
}

/** How late a due-day reminder may still go out (a tick missed). */
export const CARE_DUE_GRACE_DAYS = 1;

export function careDueAlerts(
  tasks: readonly OpenCareTask[],
  todayYmd: string,
  locale?: string | null
): PushAlert[] {
  const out: PushAlert[] = [];
  for (const task of tasks) {
    const { meta } = task;
    const name = task.subjectName ?? t(locale, 'push.animal.fallback');
    const batchLabel = t(locale, 'push.care.batchLabel', {
      label: careLabel(meta.careKind, locale),
      name
    });
    const url =
      meta.subjectType === 'group'
        ? `/animals/groups/${encodeURIComponent(meta.subjectId)}`
        : `/animals/${encodeURIComponent(meta.subjectId)}`;
    const lateBy = daysBetween(task.scheduledOn, todayYmd);
    if (lateBy >= 0) {
      if (lateBy > CARE_DUE_GRACE_DAYS) continue;
      const text = careAlertTextFor(meta.careKind, name, 'due', 0, locale);
      out.push({
        kind: 'animal-care-due',
        subjectId: `${meta.planId}:${meta.dueOn}:due:${task.scheduledOn}`,
        title: text.title,
        body: text.body,
        url: '/today',
        audience: { kind: 'all' },
        batchKey: 'animal-care-due',
        batchLabel
      });
      continue;
    }
    if (!isSurfaced(meta, todayYmd) || todayYmd >= meta.dueOn) continue;
    const text = careAlertTextFor(
      meta.careKind,
      name,
      'soon',
      daysBetween(todayYmd, meta.dueOn),
      locale
    );
    out.push({
      kind: 'animal-care-due',
      subjectId: `${meta.planId}:${meta.dueOn}`,
      title: text.title,
      body: text.body,
      url,
      audience: { kind: 'all' },
      batchKey: 'animal-care-due',
      batchLabel
    });
  }
  return out;
}

const FOOD_KINDS: Record<string, 'meat' | 'milk' | 'eggs'> = {
  meat: 'meat',
  preSlaughter: 'meat',
  milk: 'milk',
  eggs: 'eggs'
};

/** A tick can be missed; a hold that ended longer ago than this is old news. */
export const CLEARED_LOOKBACK_MS = 48 * HOUR_MS;

export interface ClearedHold {
  subjectKey: string;
  food: 'meat' | 'milk' | 'eggs';
  clearedAt: number;
}

/**
 * Holds on meat, milk or eggs that ended in the lookback and have nothing
 * still running or still to come for the same subject and food. The spans
 * are the hold ledger's (`projectHolds`), the same the server gates read.
 */
export function clearedHolds(
  holds: ReadonlyMap<string, readonly Span[]>,
  nowMs: number,
  lookbackMs = CLEARED_LOOKBACK_MS
): ClearedHold[] {
  const perFood = new Map<
    string,
    { subjectKey: string; food: ClearedHold['food']; spans: Span[] }
  >();
  for (const [k, spans] of holds) {
    const { key, kind } = splitHoldMapKey(k);
    const food = FOOD_KINDS[kind];
    if (!food || !(key.startsWith('animal:') || key.startsWith('group:'))) continue;
    const id = `${key}|${food}`;
    const hit = perFood.get(id) ?? { subjectKey: key, food, spans: [] };
    hit.spans.push(...spans);
    perFood.set(id, hit);
  }
  const out: ClearedHold[] = [];
  for (const { subjectKey, food, spans } of perFood.values()) {
    if (spans.some((s) => s.toMs > nowMs)) continue;
    const last = Math.max(...spans.map((s) => s.toMs));
    if (!Number.isFinite(last) || last > nowMs || last <= nowMs - lookbackMs) continue;
    out.push({ subjectKey, food, clearedAt: last });
  }
  return out.sort((a, b) => a.clearedAt - b.clearedAt || a.subjectKey.localeCompare(b.subjectKey));
}

export function withdrawalClearsAlerts(
  cleared: readonly ClearedHold[],
  labels: ReadonlyMap<string, string>,
  locale?: string | null
): PushAlert[] {
  return cleared.map((c) => {
    const name = labels.get(c.subjectKey) ?? t(locale, 'push.animal.fallback');
    const [type, id] = c.subjectKey.split(':');
    return {
      kind: 'withdrawal-clears' as const,
      subjectId: `${c.subjectKey}:${c.food}:${c.clearedAt}`,
      title: t(locale, 'push.cleared.title', { name }),
      body: t(locale, 'push.cleared.body', { name }),
      url:
        type === 'group'
          ? `/animals/groups/${encodeURIComponent(id)}`
          : `/animals/${encodeURIComponent(id)}`,
      audience: { kind: 'owners-and' as const, userIds: [] },
      batchKey: 'withdrawal-clears',
      batchLabel: name
    };
  });
}

type Subject = { subjectType: 'animal' | 'group'; subjectId: string };

/**
 * G3: one alert per covered egg or milk log (`log:<id>`) and meat
 * declaration (`meat:<id>`) in the projection, with the covered id as the
 * delivery subject so each is pushed at most once. Deleted records are left
 * out: their page cannot show them. `hrefFor` is `coveredRecordsHref`, the
 * page the /today covered-logs alert opens for that subject.
 */
export function holdCoversSaleAlerts(
  projection: Pick<HoldProjection, 'covered'>,
  loaded: { facts: readonly HoldFact[]; labels: ReadonlyMap<string, string> },
  hrefFor: (
    subjectType: Subject['subjectType'],
    subjectId: string,
    has: { logs: boolean }
  ) => string,
  locale?: string | null
): PushAlert[] {
  const records = new Map<string, Subject>();
  for (const f of loaded.facts) {
    if (f.kind === 'production' && !f.deleted && f.declaredUse && f.food !== 'meat') {
      records.set(`log:${f.id}`, f);
    } else if (f.kind === 'status' && !f.deleted && f.declaresMeat) {
      records.set(`meat:${f.id}`, f);
    }
  }
  const hits: Array<{ coveredId: string; key: string; subject: Subject }> = [];
  const withLogs = new Set<string>();
  for (const coveredId of projection.covered.keys()) {
    const subject = records.get(coveredId);
    if (!subject) continue;
    const key = `${subject.subjectType}:${subject.subjectId}`;
    hits.push({ coveredId, key, subject });
    if (coveredId.startsWith('log:')) withLogs.add(key);
  }
  const nameOf = (key: string) => loaded.labels.get(key) ?? t(locale, 'push.animal.fallback');
  hits.sort(
    (a, b) =>
      nameOf(a.key).localeCompare(nameOf(b.key)) ||
      a.key.localeCompare(b.key) ||
      a.coveredId.localeCompare(b.coveredId)
  );
  return hits.map(({ coveredId, key, subject }) => {
    const name = nameOf(key);
    return {
      kind: 'hold-covers-sale' as const,
      subjectId: coveredId,
      ...holdCoversSaleText(name, 1, 0, locale),
      url: hrefFor(subject.subjectType, subject.subjectId, { logs: withLogs.has(key) }),
      audience: { kind: 'owners-and' as const, userIds: [] },
      batchKey: 'hold-covers-sale',
      batchLabel: name,
      batchSubject: key
    };
  });
}

/** G3-09 lock-screen text: no product, dose or dates. */
export function holdCoversSaleText(
  firstName: string,
  records: number,
  otherSubjects: number,
  locale?: string | null
): { title: string; body: string } {
  return {
    title:
      otherSubjects > 0
        ? t(locale, 'push.holdSale.titleMore', { name: firstName, count: otherSubjects })
        : t(locale, 'push.holdSale.title', { name: firstName }),
    body: t(locale, 'push.holdSale.body', { count: records })
  };
}

/** One push for several alerts of a kind (D0-16: "3 holds cleared"). */
export function batchMessage(
  alerts: readonly PushAlert[],
  locale?: string | null
): {
  title: string;
  body: string;
  url: string;
} {
  if (alerts.length === 1) {
    return { title: alerts[0].title, body: alerts[0].body, url: alerts[0].url };
  }
  if (alerts[0].kind === 'hold-covers-sale') {
    const subjects = [...new Set(alerts.map((a) => a.batchSubject ?? a.url))];
    return {
      ...holdCoversSaleText(
        alerts[0].batchLabel ?? t(locale, 'push.animal.fallback'),
        alerts.length,
        subjects.length - 1,
        locale
      ),
      url: subjects.length === 1 ? alerts[0].url : '/today'
    };
  }
  const labels = [...new Set(alerts.map((a) => a.batchLabel ?? a.title))];
  const shown = labels.slice(0, 3).join('; ');
  const more = labels.length > 3 ? t(locale, 'push.batch.more', { count: labels.length - 3 }) : '';
  const list = `${shown}${more}`;
  if (alerts[0].kind === 'withdrawal-clears') {
    return {
      title: t(locale, 'push.cleared.batchTitle', { count: alerts.length }),
      body: t(locale, 'push.cleared.batchBody', { list }),
      url: '/animals'
    };
  }
  return {
    title: t(locale, 'push.care.batchTitle', { count: alerts.length }),
    body: t(locale, 'push.care.batchBody', { list }),
    url: '/today'
  };
}
