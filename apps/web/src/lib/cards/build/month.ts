import type { CardModel } from '../model';
import type { FarmSnapshot } from '../snapshot';
import { buildMonthPeriodCard, type CalendarBuildOptions } from './calendar';

/** The Month Card for `YYYY-MM` (`mo_<YYYY-MM>`). Null when the saved
 *  tasks do not reach the month's last day. */
export function buildMonthCard(
  snapshot: FarmSnapshot,
  ym: string,
  options: CalendarBuildOptions = {}
): CardModel | null {
  return buildMonthPeriodCard(snapshot, ym, options);
}
