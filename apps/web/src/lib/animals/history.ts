/** One newest-first history for an animal or group page: moves, group
 *  changes, status changes and flag changes. Pure and client-safe. */

import { STATUS_LABEL } from './display';

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
}

export interface HistoryFlag {
  id: string;
  flag: 'food_producing' | 'not_for_slaughter';
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
}

export interface HistoryInput {
  locations: readonly HistoryLocation[];
  statusEvents: readonly HistoryStatus[];
  flagChanges?: readonly HistoryFlag[];
  areaName: (id: string) => string;
  groupName: (id: string) => string;
  canUndo: boolean;
}

function isMarker(l: HistoryLocation): boolean {
  return l.toMs !== null && l.toMs === l.fromMs;
}

function statusText(e: HistoryStatus): string {
  const label = STATUS_LABEL[e.status as keyof typeof STATUS_LABEL] ?? e.status;
  const delta = e.headCountDelta ?? 0;
  if (delta > 0) return `${delta} added`;
  if (delta < 0) return `${-delta} ${label.toLowerCase()}`;
  return e.status === 'active' ? 'Marked as still here' : label;
}

function flagText(f: HistoryFlag): string {
  if (f.flag === 'food_producing') {
    return f.newValue ? 'Marked as a food animal' : 'Marked as not a food animal';
  }
  return f.newValue ? 'Marked not for slaughter' : 'Not-for-slaughter mark removed';
}

export function buildHistory(input: HistoryInput): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const lastLocation = input.locations.at(-1);
  for (const l of input.locations) {
    const latest = l.id === lastLocation?.id;
    let text: string;
    if (isMarker(l) || l.toGroupId) {
      text = l.toGroupId
        ? `Joined ${input.groupName(l.toGroupId)}`
        : `Left ${input.groupName(l.fromGroupId ?? '')}`;
    } else if (l.fromGroupId) {
      text = `Moved to ${input.areaName(l.fieldId)}, out of ${input.groupName(l.fromGroupId)}`;
    } else {
      text = `Moved to ${input.areaName(l.fieldId)}`;
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
    entries.push({
      id: `st:${e.id}`,
      at: e.occurredAt,
      text: statusText(e),
      detail: e.reason,
      undo:
        input.canUndo && e.id === lastStatus?.id && !e.locked
          ? `/api/animals/status/${e.id}`
          : null,
      locked: e.locked
    });
  }
  for (const f of input.flagChanges ?? []) {
    entries.push({
      id: `fl:${f.id}`,
      at: f.changedAt,
      text: flagText(f),
      detail: f.reason,
      undo: null,
      locked: false
    });
  }
  return entries.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}
