/** A calendar event's title in the viewer's language, for display only.
 *  The engine builds English titles; this rebuilds the common shapes from
 *  the event's fields and leaves any other title as it is, with only the
 *  crop name swapped. Stage names and plugin text stay as written, except a
 *  crop seasonal row still carrying its shipped English (OP-21). */

import { t, type MessageKey } from '$lib/i18n';
import { cropDisplayName, cropDisplayNameByEnglish } from '$lib/i18n/cropName';
import { seasonalRowText, seasonalTitleWithCrop } from '$lib/i18n/seasonalTaskText';
import type { CalendarEvent } from './engine';

const HARVEST_TARGET_KEYS: Record<string, MessageKey> = {
  'Color-break (ship green / counter-ripen)': 'plan.cal.target.colorBreak',
  'Cure & dry-storage': 'plan.cal.target.cureDryStorage',
  Dent: 'plan.cal.target.dent',
  'Dry-storage grain': 'plan.cal.target.dryStorageGrain',
  'Dry-storage harvest': 'plan.cal.target.dryStorageHarvest',
  'First cut hay': 'plan.cal.target.firstCutHay',
  'Fresh cutting': 'plan.cal.target.freshCutting',
  'Fresh eating': 'plan.cal.target.freshEating',
  'Pollinator support (no harvest)': 'plan.cal.target.pollinator',
  'Subsequent cuttings': 'plan.cal.target.subsequentCuttings',
  'Terminate (no harvest)': 'plan.cal.target.terminate',
  'Vine-ripe': 'plan.cal.target.vineRipe'
};

/** A built-in harvest target label in `locale`; plugin-written labels as is. */
export function harvestTargetLabel(label: string, locale?: string | null): string {
  const key = HARVEST_TARGET_KEYS[label];
  return key && locale ? t(locale, key) : label;
}

type TitleEvent = Pick<CalendarEvent, 'title' | 'varietyDisplayName' | 'detail'> & {
  cropPluginId?: string;
};

function shownCrop(e: TitleEvent, locale?: string | null): string {
  return e.cropPluginId
    ? cropDisplayName(e.cropPluginId, e.varietyDisplayName, locale)
    : cropDisplayNameByEnglish(e.varietyDisplayName, locale);
}

const PREFIXED: ReadonlyArray<[string, MessageKey]> = [
  ['Plant ', 'plan.cal.title.plant'],
  ['Expected emergence: ', 'plan.cal.title.emergence'],
  ['Terminate cover: ', 'plan.cal.title.terminateCover'],
  ['Harvest window: ', 'plan.cal.title.harvestWindow'],
  ['Curing in progress: ', 'plan.cal.title.curing'],
  ['Curing ready: ', 'plan.cal.title.curingReady']
];

export function calendarEventTitle(e: TitleEvent, locale?: string | null): string {
  if (!locale || locale === 'en') return e.title;
  const variety = e.varietyDisplayName;
  const name = shownCrop(e, locale);
  for (const [prefix, key] of PREFIXED) {
    if (e.title === `${prefix}${variety}`) return t(locale, key, { name });
  }
  const taskKey = typeof e.detail?.taskKey === 'string' ? e.detail.taskKey : null;
  if (taskKey && e.cropPluginId) {
    const seasonal = seasonalTitleWithCrop(e.title, locale, {
      pluginId: e.cropPluginId,
      rowKey: taskKey,
      crop: variety,
      cropShown: name
    });
    if (seasonal !== e.title) return seasonal;
  }
  const label = typeof e.detail?.label === 'string' ? e.detail.label : null;
  if (label !== null && e.title === `Harvest target — ${label}: ${variety}`) {
    return t(locale, 'plan.cal.title.harvestTarget', {
      label: harvestTargetLabel(label, locale),
      name
    });
  }
  return variety && name !== variety ? e.title.split(variety).join(name) : e.title;
}

/** The event's crop name in `locale`. */
export function calendarEventCrop(e: TitleEvent, locale?: string | null): string {
  return shownCrop(e, locale);
}

export const HARVEST_READINESS_BODY = 'Use crop-specific readiness indicators before harvest.';

/** The event's body in `locale`: the engine's own harvest line and a crop
 *  seasonal row's shipped English are translated; other plugin text and
 *  spray-window notes stay as written. */
export function calendarEventBody(
  e: Pick<CalendarEvent, 'body'> & Partial<Pick<CalendarEvent, 'cropPluginId' | 'detail'>>,
  locale?: string | null
): string | undefined {
  if (!locale || locale === 'en' || e.body === undefined) return e.body;
  if (e.body === HARVEST_READINESS_BODY) return t(locale, 'plan.cal.body.harvestReadiness');
  const taskKey = typeof e.detail?.taskKey === 'string' ? e.detail.taskKey : null;
  return seasonalRowText(e.cropPluginId, taskKey, 'body', e.body, locale);
}
