/** OP-22 (docs/design/ORCHARD_CALENDAR.md): the fixed dates of crop seasonal
 *  rows (`dayOfYear`, `windowDays`, `daysAfterPlanting`) and of the
 *  perennial day-of-year stage templates have no source. They are shown as
 *  `fallback` with "Typical timing. Adjust to your farm.", worked out here at
 *  display time; nothing is stored and no safety logic reads it. */

const TYPICAL_TASK_KEY = /^(?:crop:[^:]+:seasonal:.+|derived:(?:seasonal-task|orchard-task):.*)$/;

/** A task made from a crop seasonal row: materialized (`crop:<id>:seasonal:
 *  <row>`) or scheduled from a /today suggestion (`derived:seasonal-task:`,
 *  `derived:orchard-task:`). */
export function isTypicalTimingTask(task: { pluginTemplateKey?: string | null }): boolean {
  const key = task.pluginTemplateKey;
  return typeof key === 'string' && TYPICAL_TASK_KEY.test(key);
}

/** A calendar event placed on a seasonal row's day of year or days after
 *  planting, on a perennial stage template's day range, or on a typical
 *  spring date (winter small grains, #629). */
export function isTypicalTimingEvent(e: {
  kind: string;
  detail?: Record<string, unknown> | null;
}): boolean {
  if (e.kind === 'seasonal-task' || e.kind === 'orchard-task') return true;
  if (e.detail?.typicalTiming === true) return true;
  return e.kind === 'stage-window' && e.detail?.system === 'perennial-calendar';
}
