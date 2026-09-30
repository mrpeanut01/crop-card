import type { CardModel } from '../model';
import type { FarmSnapshot } from '../snapshot';
import { buildWeekPeriodCard, type CalendarBuildOptions } from './calendar';

/** The Week Card for the week holding `anyDayYmd` (`wk_<YYYY-MM-DD>`),
 *  snapped to the first day of that week. Null outside the saved tasks. */
export function buildWeekCard(
  snapshot: FarmSnapshot,
  anyDayYmd: string,
  options: CalendarBuildOptions = {}
): CardModel | null {
  return buildWeekPeriodCard(snapshot, anyDayYmd, options);
}
