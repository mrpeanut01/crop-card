/**
 * The /scout "Watch for" strip, as plain view data built from the
 * `GET /api/weather/degree-days` shape. Client-safe and pure, so the copy
 * can be tested against the spray-word pattern without rendering.
 */

import type { DegreeDaysResult, DegreeDayModelResult } from './degreeDayResult';
import { shortDay } from './pestModels';
import { t, type MessageKey } from '$lib/i18n';
import { formatCalendarDate } from '$lib/prefs';

export type WatchForProvenance = 'plugin' | 'data' | 'manual' | 'fallback';

export interface WatchForModel {
  id: string;
  title: string;
  stageLabel: string | null;
  lines: string[];
  method: string;
  station: string | null;
  biofix: { source: WatchForProvenance; text: string } | null;
  acceptsCatch: boolean;
  catchDate: string | null;
}

export interface WatchForView {
  show: boolean;
  message: string | null;
  models: WatchForModel[];
}

const METHOD_KEY: Record<DegreeDayModelResult['method'], MessageKey> = {
  'simple-average': 'scout.watch.method.simpleAverage',
  'single-sine': 'scout.watch.method.singleSine'
};

/** "Sep 27" in English; the locale's short month and day otherwise. */
function dayText(ymd: string, locale?: string | null): string {
  return locale && locale !== 'en'
    ? formatCalendarDate(ymd, 'month-day', {}, locale)
    : shortDay(ymd);
}

export function methodLine(
  m: Pick<DegreeDayModelResult, 'baseTempF' | 'upperCutoffF' | 'method'>,
  locale?: string | null
): string {
  const cutoff =
    m.upperCutoffF === null ? '' : t(locale, 'scout.watch.cutoff', { f: m.upperCutoffF });
  return t(locale, 'scout.watch.methodLine', {
    base: m.baseTempF,
    cutoff,
    method: t(locale, METHOD_KEY[m.method])
  });
}

export function biofixText(
  b: DegreeDayModelResult['biofix'],
  locale?: string | null
): { source: WatchForProvenance; text: string } | null {
  if (!b.date || !b.provenance) return null;
  const day = dayText(b.date, locale);
  if (b.provenance === 'manual')
    return { source: 'manual', text: t(locale, 'scout.watch.fromCatch', { day }) };
  if (b.provenance === 'fallback') {
    return {
      source: 'fallback',
      text: b.acceptsManual
        ? t(locale, 'scout.watch.fromUsualCatch', { day })
        : t(locale, 'scout.watch.fromUsual', { day })
    };
  }
  return { source: 'plugin', text: t(locale, 'scout.watch.from', { day }) };
}

function stationText(r: DegreeDaysResult): string | null {
  if (!r.station) return null;
  return `${r.station.label}, ${Math.round(r.station.distanceMiles)} mi`;
}

export function watchForView(
  result: DegreeDaysResult | null,
  locale?: string | null
): WatchForView {
  if (!result) return { show: false, message: null, models: [] };
  const applicable = result.models.filter((m) => m.applicable);
  if (applicable.length === 0) return { show: false, message: null, models: [] };
  const station = stationText(result);
  const models = applicable
    .filter((m) => m.showOnScout)
    .map((m) => ({
      id: m.modelId,
      title: m.pest.commonName,
      stageLabel: m.status.inWindow && m.status.stage ? m.status.stage.label : null,
      lines: m.lines,
      method: methodLine(m, locale),
      station,
      biofix: biofixText(m.biofix, locale),
      acceptsCatch: m.biofix.acceptsManual,
      catchDate: m.biofix.provenance === 'manual' ? m.biofix.date : null
    }));
  const message = result.message;
  return { show: models.length > 0 || message !== null, message, models };
}
