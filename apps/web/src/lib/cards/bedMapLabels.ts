/**
 * Labels for plantings on the printed bed map (#481). A planting shows its
 * icon and name when the name fits inside its spot; otherwise it gets a
 * number, and the legend under the map says what each number is.
 */

import { t } from '$lib/i18n';
import { dateToLocaleDateString } from '$lib/intlCache';
import { intlLocale } from '$lib/prefs';
import type { CardBedMap, CardBedMapPlanting } from './model';

export interface PlantingLabel {
  /** The name to print inside the spot, or null when it shows a number. */
  text: string | null;
  n: number | null;
  /** Icon size in feet; 0 when the spot is too small for one. */
  iconFt: number;
}

export interface BedMapLegendRow {
  n: number;
  text: string;
}

const CHAR_WIDTH = 0.58;

export function textWidth(text: string, font: number): number {
  return text.length * font * CHAR_WIDTH;
}

function shortDate(ymd: string, locale?: string | null): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return dateToLocaleDateString(new Date(Date.UTC(y, m - 1, d)), intlLocale(locale), {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

export function legendText(p: CardBedMapPlanting, locale?: string | null): string {
  const bits = [p.name];
  if (p.later && p.from) {
    bits.push(t(locale, 'gardenlib.map.from', { date: shortDate(p.from, locale) }));
  }
  if (!p.placed) bits.push(t(locale, 'gardenlib.map.notPlaced'));
  return bits.join(', ');
}

export function bedMapLabels(
  map: CardBedMap,
  font: number,
  locale?: string | null
): { labels: PlantingLabel[][]; legend: BedMapLegendRow[] } {
  const legend: BedMapLegendRow[] = [];
  const pad = font * 0.25;
  const labels = map.beds.map((b) =>
    (b.plantings ?? []).map((p) => {
      const icon = Math.min(p.w - pad, p.l - pad, font * 1.2);
      const iconFt = icon >= font * 0.6 ? icon : 0;
      const room = p.w - iconFt - pad * 2;
      const fits = p.l >= font * 1.1 && textWidth(p.name, font) <= room;
      if (fits && p.placed && !p.later) return { text: p.name, n: null, iconFt };
      const n = legend.length + 1;
      legend.push({ n, text: legendText(p, locale) });
      return { text: null, n, iconFt };
    })
  );
  return { labels, legend };
}
