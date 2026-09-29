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
 *
 * Lock-screen and email text names the animal or group and the care kind
 * only, never a product or hold detail. Several alerts of one kind in the
 * same tick go out as one push (`batchKey`).
 */

import {
  CARE_KIND_LABEL,
  careAlertText,
  daysBetween,
  isSurfaced,
  type CareTaskMeta
} from '$lib/animals/carePlans';
import { splitHoldMapKey, type Span } from '$lib/safety/holdLedger';
import { HOUR_MS, type PushAlert } from './triggers';

export interface OpenCareTask {
  meta: CareTaskMeta;
  /** The task's day (`YYYY-MM-DD`): the due day, or later after a snooze. */
  scheduledOn: string;
  subjectName: string;
}

/** How late a due-day reminder may still go out (a tick missed). */
export const CARE_DUE_GRACE_DAYS = 1;

export function careDueAlerts(tasks: readonly OpenCareTask[], todayYmd: string): PushAlert[] {
  const out: PushAlert[] = [];
  for (const t of tasks) {
    const { meta } = t;
    const url =
      meta.subjectType === 'group'
        ? `/animals/groups/${encodeURIComponent(meta.subjectId)}`
        : `/animals/${encodeURIComponent(meta.subjectId)}`;
    const lateBy = daysBetween(t.scheduledOn, todayYmd);
    if (lateBy >= 0) {
      if (lateBy > CARE_DUE_GRACE_DAYS) continue;
      const text = careAlertText(meta.careKind, t.subjectName, 'due', 0);
      out.push({
        kind: 'animal-care-due',
        subjectId: `${meta.planId}:${meta.dueOn}:due:${t.scheduledOn}`,
        title: text.title,
        body: text.body,
        url: '/today',
        audience: { kind: 'all' },
        batchKey: 'animal-care-due',
        batchLabel: `${CARE_KIND_LABEL[meta.careKind]}: ${t.subjectName}`
      });
      continue;
    }
    if (!isSurfaced(meta, todayYmd) || todayYmd >= meta.dueOn) continue;
    const text = careAlertText(
      meta.careKind,
      t.subjectName,
      'soon',
      daysBetween(todayYmd, meta.dueOn)
    );
    out.push({
      kind: 'animal-care-due',
      subjectId: `${meta.planId}:${meta.dueOn}`,
      title: text.title,
      body: text.body,
      url,
      audience: { kind: 'all' },
      batchKey: 'animal-care-due',
      batchLabel: `${CARE_KIND_LABEL[meta.careKind]}: ${t.subjectName}`
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
  labels: ReadonlyMap<string, string>
): PushAlert[] {
  return cleared.map((c) => {
    const name = labels.get(c.subjectKey) ?? 'An animal';
    const [type, id] = c.subjectKey.split(':');
    return {
      kind: 'withdrawal-clears' as const,
      subjectId: `${c.subjectKey}:${c.food}:${c.clearedAt}`,
      title: `Hold cleared: ${name}`,
      body: `A hold on ${name} has ended. Open CropCard to check before use.`,
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

/** One push for several alerts of a kind (D0-16: "3 holds cleared"). */
export function batchMessage(alerts: readonly PushAlert[]): {
  title: string;
  body: string;
  url: string;
} {
  if (alerts.length === 1) {
    return { title: alerts[0].title, body: alerts[0].body, url: alerts[0].url };
  }
  const labels = [...new Set(alerts.map((a) => a.batchLabel ?? a.title))];
  const shown = labels.slice(0, 3).join('; ');
  const more = labels.length > 3 ? `; and ${labels.length - 3} more` : '';
  if (alerts[0].kind === 'withdrawal-clears') {
    return {
      title: `${alerts.length} holds cleared`,
      body: `Holds have ended for ${shown}${more}. Open CropCard to check before use.`,
      url: '/animals'
    };
  }
  return {
    title: `${alerts.length} animal care jobs`,
    body: `Coming up or due: ${shown}${more}.`,
    url: '/today'
  };
}
