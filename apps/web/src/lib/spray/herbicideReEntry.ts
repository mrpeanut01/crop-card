/**
 * #640: herbicide re-entry intervals. Herbicide plugins carry an optional,
 * source-gated `reEntryIntervalHours`; a product without one has no REI on
 * file and is never given an invented one.
 */

const HOUR_MS = 60 * 60 * 1000;

export interface TankReEntry {
  /** Longest REI any product in the tank has on file; null when none has one. */
  longestHours: number | null;
  /** Every product in the tank has an REI on file. */
  complete: boolean;
}

function validHours(h: unknown): h is number {
  return typeof h === 'number' && Number.isFinite(h) && h >= 0;
}

export function tankReEntry(hours: ReadonlyArray<number | null | undefined>): TankReEntry {
  let longest: number | null = null;
  let complete = hours.length > 0;
  for (const h of hours) {
    if (!validHours(h)) {
      complete = false;
      continue;
    }
    longest = longest === null ? h : Math.max(longest, h);
  }
  return { longestHours: longest, complete };
}

/** The clear time stored on a new herbicide spray record: only when every
 *  product has an REI on file, so the record never claims a complete REI. */
export function storedReEntryClearAt(
  occurredAt: number,
  hours: ReadonlyArray<number | null | undefined>
): number | null {
  const tank = tankReEntry(hours);
  return tank.complete && tank.longestHours !== null
    ? occurredAt + tank.longestHours * HOUR_MS
    : null;
}

export interface HerbicideReEntry {
  clearAt: number;
  /** False when another product in the tank has no REI on file, so the
   *  real clear time may be later. */
  complete: boolean;
}

/**
 * The re-entry window of one herbicide spray record: the longer of the clear
 * time stored when it was saved and the longest REI the library has now, so
 * newly landed label data shows on older sprays and later data can never
 * shorten a stored one. Null when nothing is on file.
 */
export function herbicideReEntry(
  occurredAt: number,
  storedClearAt: number | null | undefined,
  currentHours: ReadonlyArray<number | null | undefined>
): HerbicideReEntry | null {
  const stored =
    typeof storedClearAt === 'number' && storedClearAt >= occurredAt ? storedClearAt : null;
  const tank = tankReEntry(currentHours);
  const fromLibrary = tank.longestHours !== null ? occurredAt + tank.longestHours * HOUR_MS : null;
  if (stored === null && fromLibrary === null) return null;
  return {
    clearAt: Math.max(stored ?? -Infinity, fromLibrary ?? -Infinity),
    complete: stored !== null || tank.complete
  };
}

/** Whether a re-entry window is still running at `now`. */
export function reEntryActive(rei: HerbicideReEntry | null, now: number): boolean {
  return rei !== null && rei.clearAt >= now;
}
