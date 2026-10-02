/** One newest-first history for an animal or group page: moves, group
 *  changes, status changes and flag changes. Pure and client-safe. */

import { STATUS_LABEL } from './display';
import { lateLabel } from '$lib/records/lateLabel';
import { t, type TranslateKey } from '$lib/i18n';

export interface HistoryLocation {
  id: string;
  fieldId: string;
  fromMs: number;
  toMs: number | null;
  fromGroupId: string | null;
  toGroupId: string | null;
}

export interface HistoryStatus {
  id: string;
  status: string;
  occurredAt: number;
  reason: string | null;
  headCountDelta: number | null;
  locked: boolean;
  /** Meat declared as food that a hold now covers (G3-03). */
  inHold?: boolean;
  /** Server save time + 48 hours (32G G4-13); null when it has none. */
  voidableUntilMs?: number | null;
  /** Saved more than 48 hours after its date (32G G2-01). */
  recordedLate?: boolean;
  /** Server save time, for the days in the late marker. */
  createdAt?: number;
}

export interface HistoryFlag {
  id: string;
  flag: 'food_producing' | 'not_for_slaughter' | 'presumed_lactating';
  newValue: boolean;
  reason: string;
  changedAt: number;
}

export interface HistoryEntry {
  id: string;
  at: number;
  text: string;
  detail: string | null;
  /** Owner-only undo: the endpoint to DELETE. */
  undo: string | null;
  locked: boolean;
  /** A meat declaration inside a hold, so the owner can tell the buyer. */
  inHold?: boolean;
  /** Owner void (32G G4): the endpoint to POST and until when it is open. */
  voidUrl?: string;
  voidableUntilMs?: number | null;
  /** "Saved N days after its date" (32G G2-01), or absent. */
  late?: string;
}

export interface HistoryInput {
  locations: readonly HistoryLocation[];
  statusEvents: readonly HistoryStatus[];
  flagChanges?: readonly HistoryFlag[];
  areaName: (id: string) => string;
  groupName: (id: string) => string;
  canUndo: boolean;
  /** The viewer is the interactive owner (32G G4-13). */
  canVoid?: boolean;
  /** The viewer's language for the entry text; English when absent. */
  locale?: string | null;
}

function isMarker(l: HistoryLocation): boolean {
  return l.toMs !== null && l.toMs === l.fromMs;
}

function statusText(e: HistoryStatus, locale?: string | null): string {
  const known = Object.prototype.hasOwnProperty.call(STATUS_LABEL, e.status);
  const label = STATUS_LABEL[e.status as keyof typeof STATUS_LABEL] ?? e.status;
  const delta = e.headCountDelta ?? 0;
  if (delta > 0) return t(locale, 'animallib.history.added', { count: delta });
  if (delta < 0) {
    return known
      ? t(locale, `animallib.history.gone.${e.status}` as TranslateKey, { count: -delta })
      : `${-delta} ${label.toLowerCase()}`;
  }
  if (e.status === 'active') return t(locale, 'animallib.history.stillHere');
  return known ? t(locale, `animals.status.${e.status}` as TranslateKey) : label;
}

const DAY_MS = 86_400_000;

function statusLate(e: HistoryStatus): string | null {
  const days =
    e.createdAt !== undefined && e.createdAt > e.occurredAt
      ? Math.floor((e.createdAt - e.occurredAt) / DAY_MS)
      : null;
  return lateLabel(e.recordedLate === true, days);
}

function flagText(f: HistoryFlag, locale?: string | null): string {
  if (f.flag === 'food_producing') {
    return t(
      locale,
      f.newValue ? 'animallib.history.markedFood' : 'animallib.history.markedNotFood'
    );
  }
  if (f.flag === 'presumed_lactating') {
    return t(locale, f.newValue ? 'animallib.history.inMilkAgain' : 'animallib.history.notInMilk');
  }
  return t(
    locale,
    f.newValue ? 'animallib.history.markedNoSlaughter' : 'animallib.history.noSlaughterRemoved'
  );
}

export function buildHistory(input: HistoryInput): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const lastLocation = input.locations.at(-1);
  for (const l of input.locations) {
    const latest = l.id === lastLocation?.id;
    let text: string;
    if (isMarker(l) || l.toGroupId) {
      text = l.toGroupId
        ? t(input.locale, 'animallib.history.joined', { group: input.groupName(l.toGroupId) })
        : t(input.locale, 'animallib.history.left', {
            group: input.groupName(l.fromGroupId ?? '')
          });
    } else if (l.fromGroupId) {
      text = t(input.locale, 'animallib.history.movedOutOf', {
        area: input.areaName(l.fieldId),
        group: input.groupName(l.fromGroupId)
      });
    } else {
      text = t(input.locale, 'animallib.history.movedTo', { area: input.areaName(l.fieldId) });
    }
    entries.push({
      id: `loc:${l.id}`,
      at: l.fromMs,
      text,
      detail: null,
      undo:
        input.canUndo && latest && !l.fromGroupId && !l.toGroupId && !isMarker(l)
          ? `/api/animals/locations/${l.id}`
          : null,
      locked: false
    });
  }
  const lastStatus = input.statusEvents.at(-1);
  for (const e of input.statusEvents) {
    const late = statusLate(e);
    entries.push({
      id: `st:${e.id}`,
      at: e.occurredAt,
      text: statusText(e, input.locale),
      detail: e.reason,
      undo:
        input.canUndo && e.id === lastStatus?.id && !e.locked
          ? `/api/animals/status/${e.id}`
          : null,
      locked: e.locked,
      ...(e.inHold ? { inHold: true } : {}),
      ...(late ? { late } : {}),
      ...(input.canVoid && e.id === lastStatus?.id
        ? {
            voidUrl: `/api/animals/status/${e.id}/void`,
            voidableUntilMs: e.voidableUntilMs ?? null
          }
        : {})
    });
  }
  for (const f of input.flagChanges ?? []) {
    entries.push({
      id: `fl:${f.id}`,
      at: f.changedAt,
      text: flagText(f, input.locale),
      detail: f.reason,
      undo: null,
      locked: false
    });
  }
  return entries.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}
