/**
 * Phase 32G (G2): the neutral marker for a record the server saved more
 * than 48 hours after the date it records. Offline items are stamped when
 * the queue drains, so the copy says when it was saved, not that anyone
 * was late. A label only; no gate reads it.
 */

export function lateLabel(recordedLate: boolean, daysLate: number | null): string | null {
  if (!recordedLate) return null;
  if (daysLate === null || !Number.isFinite(daysLate) || daysLate < 1) return 'Saved late';
  const days = Math.floor(daysLate);
  return `Saved ${days} ${days === 1 ? 'day' : 'days'} after its date`;
}

export interface LateCells {
  recorded_late: '' | 'yes' | 'no';
  days_after_date: string;
}

export const UNTRACKED_LATE_CELLS: LateCells = { recorded_late: '', days_after_date: '' };

/** The two CSV columns (G2-08). `recordedLate` undefined means the kind does not track it. */
export function lateCells(recordedLate: boolean | undefined, daysLate: number | null): LateCells {
  if (recordedLate === undefined) return { ...UNTRACKED_LATE_CELLS };
  if (!recordedLate) return { recorded_late: 'no', days_after_date: '' };
  return {
    recorded_late: 'yes',
    days_after_date:
      daysLate !== null && Number.isFinite(daysLate) && daysLate >= 1
        ? String(Math.floor(daysLate))
        : ''
  };
}

export const LATE_LEGEND =
  'A record marked "Saved N days after its date" reached the server more than 48 hours after the date it records, for example from a phone that was offline. Only hay cuttings and animal records track this; for every other kind the marker is left blank because the app does not know.';
