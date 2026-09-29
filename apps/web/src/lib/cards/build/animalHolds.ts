/**
 * The HOLD lines on offline Animal and Flock Cards (32D, D1-01 to D1-04,
 * D2-03). Pure and client-safe.
 *
 * The server's kernel projected every open hold into the snapshot; this
 * module never computes a clear date. It only reads those spans against
 * `now`, and only ever makes the reading more careful: a "no holds" reading
 * turns into "can't confirm" when the snapshot is over a day old, was built
 * under other rules, predates animal holds, or this phone has an unsynced
 * treatment or move for the subject. HOLD, unknown and never-for-food lines
 * always show as they are.
 */

import { formatClearDate, type Food } from '$lib/safety/animalWithdrawal';
import { RULES_VERSION } from '$lib/safety/version';
import { formatInstant, type Prefs } from '$lib/prefs';
import type { CardStatus } from '../model';
import type { FarmSnapshot, SnapshotAnimalHold, SnapshotHoldStatus } from '../snapshot';

const HOUR_MS = 3_600_000;

/** After this, a clear reading from the snapshot can't be confirmed. */
export const HOLD_CONFIRM_MAX_AGE_MS = 24 * HOUR_MS;

export type SubjectRef = `animal:${string}` | `group:${string}`;

export function animalSubject(id: string): SubjectRef {
  return `animal:${id}`;
}

export function groupSubject(id: string): SubjectRef {
  return `group:${id}`;
}

export interface FoodHoldReading {
  food: Food;
  status: SnapshotHoldStatus;
  /** Latest end among the open spans; null for unknown or prohibited. */
  clearMs: number | null;
}

export type HoldReadingState = 'held' | 'clear' | 'unconfirmed';

export interface HoldReading {
  state: HoldReadingState;
  holds: FoodHoldReading[];
  /** Why a clear reading can't be confirmed. */
  unconfirmedReason: 'stale' | 'rules' | 'no-data' | 'unsynced' | null;
}

const RANK: Record<SnapshotHoldStatus, number> = { held: 0, unknown: 1, prohibited: 2 };

/** The strongest open hold per food for one subject, in `foods` order. */
export function openHolds(
  holds: readonly SnapshotAnimalHold[] | undefined,
  subject: string,
  foods: readonly Food[],
  now: number
): FoodHoldReading[] {
  const out: FoodHoldReading[] = [];
  for (const food of foods) {
    let best: FoodHoldReading | null = null as FoodHoldReading | null;
    for (const h of holds ?? []) {
      if (h.subject !== subject || h.food !== food) continue;
      if (h.clearMs !== null && h.clearMs <= now) continue;
      const status: SnapshotHoldStatus =
        h.status === 'held' && h.clearMs === null ? 'unknown' : h.status;
      const next: FoodHoldReading = { food, status, clearMs: status === 'held' ? h.clearMs : null };
      if (!best || RANK[status] > RANK[best.status]) best = next;
      else if (status === 'held' && best.status === 'held' && (h.clearMs ?? 0) > (best.clearMs ?? 0)) {
        best = next;
      }
    }
    if (best) out.push(best);
  }
  return out;
}

export interface ReadHoldsOptions {
  now: number;
  /** Subjects (`animal:<id>`, `group:<id>`) with a treatment or move still
   *  queued on this phone for the active Owner. */
  unsynced?: ReadonlySet<string>;
  /** The RULES_VERSION of the code on this device. */
  rulesVersion?: string;
}

/** What a card can honestly say about a subject's holds. `subjects` lists
 *  the keys whose unsynced rows count (the subject and its group). */
export function readHolds(
  snapshot: FarmSnapshot,
  subject: string,
  foods: readonly Food[],
  opts: ReadHoldsOptions,
  subjects: readonly string[] = [subject]
): HoldReading {
  const holds = openHolds(snapshot.animalHolds, subject, foods, opts.now);
  if (holds.length) return { state: 'held', holds, unconfirmedReason: null };
  let reason: HoldReading['unconfirmedReason'] = null;
  if (subjects.some((s) => opts.unsynced?.has(s))) reason = 'unsynced';
  else if (!snapshot.animalHolds) reason = 'no-data';
  else if (snapshot.rulesVersion !== (opts.rulesVersion ?? RULES_VERSION)) reason = 'rules';
  else if (opts.now - snapshot.generatedAt > HOLD_CONFIRM_MAX_AGE_MS) reason = 'stale';
  return reason
    ? { state: 'unconfirmed', holds: [], unconfirmedReason: reason }
    : { state: 'clear', holds: [], unconfirmedReason: null };
}

export function holdTimeZone(snapshot: FarmSnapshot, prefs: Prefs): string {
  return snapshot.holdTimeZone || prefs.timeZone;
}

export function holdLine(h: FoodHoldReading, timeZone: string): string {
  if (h.status === 'prohibited') return `Never for food: ${h.food}`;
  if (h.status === 'unknown' || h.clearMs === null) {
    return `HOLD ${h.food}: end date not known. The owner can add the label or vet time when online.`;
  }
  return `HOLD ${h.food} until ${formatClearDate(h.clearMs, timeZone)}`;
}

/** The lines a card shows in every variant, printed included. Empty when
 *  the subject gives no food to hold. */
export function holdNotices(
  snapshot: FarmSnapshot,
  reading: HoldReading,
  prefs: Prefs,
  foods: readonly Food[]
): string[] {
  if (foods.length === 0) return [];
  const asOf = formatInstant(snapshot.generatedAt, prefs, 'datetime');
  const tz = holdTimeZone(snapshot, prefs);
  if (reading.state === 'held') {
    return [...reading.holds.map((h) => holdLine(h, tz)), `Holds as of ${asOf}.`];
  }
  if (reading.state === 'unconfirmed') {
    if (reading.unconfirmedReason === 'unsynced') {
      return [
        `A treatment, move or spray on this phone has not synced yet, so holds can't be confirmed. Holds as of ${asOf}.`
      ];
    }
    return [`Hold status not checked since ${asOf}, can't confirm.`];
  }
  return [`No holds on file as of ${asOf}.`];
}

export function holdStatus(reading: HoldReading, foods: readonly Food[]): CardStatus | undefined {
  if (foods.length === 0) return undefined;
  if (reading.state === 'held') {
    const never = reading.holds.every((h) => h.status === 'prohibited');
    return never
      ? { id: 'never-for-food', label: 'Never for food', tone: 'rust' }
      : { id: 'hold', label: 'On hold', tone: 'rust' };
  }
  if (reading.state === 'unconfirmed') {
    return { id: 'unconfirmed', label: "Can't confirm", tone: 'wheat' };
  }
  return undefined;
}
