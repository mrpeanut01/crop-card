/** The orchard panel's offline lines from the saved Card snapshot (#593,
 *  rulings OS-1 to OS-6 in docs/design/ORCHARD_CALENDAR.md). Read-only: a
 *  saved mark is shown with its date and the copy's time, a copy from an
 *  earlier farm-local year shows no mark, and nothing here gives a bloom
 *  answer (OC-3). Client-safe and pure. */

import type { FarmSnapshot, SnapshotOrchardPlanting } from '$lib/cards/snapshot';
import { ymdInZone } from '$lib/prefs';
import type { AudienceChoice } from './calendar';
import type { OrchardCalendarView, OrchardStageView } from './calendarView';

export interface OfflineOrchardRow {
  cropId: string;
  cropName: string;
  status: SnapshotOrchardPlanting['status'];
  audience: AudienceChoice;
  calendar: OrchardCalendarView | null;
  /** This year's mark and its stage, or null. */
  mark: { stage: OrchardStageView; markedAt: number; markedByName: string } | null;
  /** The farm-local year now, which the marks are counted in. */
  year: number;
}

export interface OfflineOrchard {
  rows: OfflineOrchardRow[];
  /** When the saved copy was made. */
  savedAt: number;
}

export function offlineOrchardRows(
  snapshot: FarmSnapshot | null | undefined,
  target: { cropId?: string; areaId?: string },
  now: number
): OfflineOrchard | null {
  const orchard = snapshot?.orchard;
  if (!snapshot || !orchard) return null;
  const year = Number(ymdInZone(now, orchard.timeZone).slice(0, 4));
  const sameYear = year === orchard.year;
  const planting = new Map(snapshot.plantings.map((p) => [p.id, p]));
  let wanted: SnapshotOrchardPlanting[];
  if (target.cropId) {
    wanted = orchard.plantings.filter((r) => r.cropId === target.cropId);
  } else if (target.areaId) {
    const blocks = new Set(
      snapshot.blocks.filter((b) => b.areaId === target.areaId).map((b) => b.id)
    );
    wanted = orchard.plantings.filter((r) => {
      const p = planting.get(r.cropId);
      return !!p && blocks.has(p.blockId) && p.status !== 'harvested';
    });
  } else return null;
  if (!wanted.length) return null;
  const rows = wanted.map((r): OfflineOrchardRow => {
    const calendar = r.calendarId ? (orchard.calendars[r.calendarId] ?? null) : null;
    const stage =
      sameYear && calendar && r.mark
        ? (calendar.stages.find((s) => s.id === r.mark!.stageId) ?? null)
        : null;
    return {
      cropId: r.cropId,
      cropName: planting.get(r.cropId)?.varietyDisplayName ?? r.cropId,
      status: calendar ? r.status : r.status === 'calendar' ? 'none' : r.status,
      audience: r.audience,
      calendar,
      mark:
        stage && r.mark
          ? { stage, markedAt: r.mark.markedAt, markedByName: r.mark.markedByName }
          : null,
      year
    };
  });
  return { rows, savedAt: snapshot.generatedAt };
}
