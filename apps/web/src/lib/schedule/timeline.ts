import type { CalendarEvent } from '$lib/calendar/engine';
import { DAY_MS } from './constants';

/**
 * Returns true when any derived spray-window event's end falls within the
 * PHI zone before the harvest-window start.
 *
 * phiDays: preHarvestIntervalDays from the crop plugin (plus any user buffer).
 */
export function detectPhiConflict(events: CalendarEvent[], phiDays: number): boolean {
  if (phiDays <= 0) return false;
  const harvest = events.find((e) => e.kind === 'harvest-window');
  if (!harvest) return false;
  const blockedZoneStart = harvest.startMs - phiDays * DAY_MS;
  return events.some(
    (e) => e.kind === 'spray-window' && e.endMs >= blockedZoneStart && e.startMs <= harvest.startMs
  );
}

/** Returns the harvest-window event if present, undefined otherwise. */
export function harvestWindow(
  events: CalendarEvent[]
): CalendarEvent | undefined {
  return events.find((e) => e.kind === 'harvest-window');
}

/** Returns all spray-window events. */
export function sprayWindows(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((e) => e.kind === 'spray-window');
}

/** Returns all fertility-related seasonal tasks. */
export function fertilityTasks(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter(
    (e) => e.kind === 'seasonal-task' && (e.detail?.kind === 'fertilize' || e.detail?.kind === 'spray')
  );
}
