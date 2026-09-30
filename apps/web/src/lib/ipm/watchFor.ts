/**
 * The /scout "Watch for" strip, as plain view data built from the
 * `GET /api/weather/degree-days` shape. Client-safe and pure, so the copy
 * can be tested against the spray-word pattern without rendering.
 */

import type { DegreeDaysResult, DegreeDayModelResult } from './degreeDayResult';
import { shortDay } from './pestModels';

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

const METHOD_LABEL: Record<DegreeDayModelResult['method'], string> = {
  'simple-average': 'simple average',
  'single-sine': 'single sine'
};

export function methodLine(
  m: Pick<DegreeDayModelResult, 'baseTempF' | 'upperCutoffF' | 'method'>
): string {
  const cutoff = m.upperCutoffF === null ? '' : `, upper cutoff ${m.upperCutoffF}°F`;
  return `Base ${m.baseTempF}°F${cutoff}, ${METHOD_LABEL[m.method]} method.`;
}

export function biofixText(
  b: DegreeDayModelResult['biofix']
): { source: WatchForProvenance; text: string } | null {
  if (!b.date || !b.provenance) return null;
  const day = shortDay(b.date);
  if (b.provenance === 'manual')
    return { source: 'manual', text: `Counting from your first trap catch on ${day}.` };
  if (b.provenance === 'fallback') {
    return {
      source: 'fallback',
      text: b.acceptsManual
        ? `Counting from ${day}, the model's usual start. Record a trap catch to use your own date.`
        : `Counting from ${day}, the model's usual start.`
    };
  }
  return { source: 'plugin', text: `Counting from ${day}.` };
}

function stationText(r: DegreeDaysResult): string | null {
  if (!r.station) return null;
  return `${r.station.label}, ${Math.round(r.station.distanceMiles)} mi`;
}

export function watchForView(result: DegreeDaysResult | null): WatchForView {
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
      method: methodLine(m),
      station,
      biofix: biofixText(m.biofix),
      acceptsCatch: m.biofix.acceptsManual,
      catchDate: m.biofix.provenance === 'manual' ? m.biofix.date : null
    }));
  const message = result.message;
  return { show: models.length > 0 || message !== null, message, models };
}
