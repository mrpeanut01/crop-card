import { zoneAbbrev, type Prefs } from '$lib/prefs';
import { dateToLocaleString } from '$lib/intlCache';

/** `YYYY-MM-DD HH:mm` in the user's zone: the compact, sortable stamp the
 *  compliance exports print in their human-readable columns. */
export function localStamp(value: Date | number, prefs: Pick<Prefs, 'timeZone'>): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return dateToLocaleString(d, 'sv-SE', { hour12: false, timeZone: prefs.timeZone }).slice(0, 16);
}

/** `YYYY-MM-DD` in the user's zone. */
export function localDay(value: Date | number, prefs: Pick<Prefs, 'timeZone'>): string {
  return localStamp(value, prefs).slice(0, 10);
}

/** "EDT · America/New_York" — printed once per export so an inspector
 *  knows which zone the local times are in. */
export function zoneCaption(
  prefs: Pick<Prefs, 'timeZone'>,
  at: Date | number = Date.now()
): string {
  const abbrev = zoneAbbrev(prefs, at);
  return abbrev === prefs.timeZone ? prefs.timeZone : `${abbrev} · ${prefs.timeZone}`;
}
