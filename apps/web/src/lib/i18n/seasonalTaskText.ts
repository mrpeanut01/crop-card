/** Display-only seasonal task text (OP-21, docs/design/ORCHARD_CALENDAR.md).
 *  A crop plugin's `seasonalTasks` / `orchardSeasonalTasks` rows are English
 *  data, and a task made from one stores that English. The English catalog
 *  holds the shipped text of every row under `seasonal.<pluginId>.<rowKey>.
 *  <title|body>`; the viewer's language replaces a title or body only while
 *  it still equals that shipped English, so a farm copy's or a farmer's own
 *  wording is always shown as written. */

import { t, type MessageKey } from '$lib/i18n';
import { en } from './catalogs/en';
import { cropDisplayNameByEnglish } from './cropName';

export type SeasonalPart = 'title' | 'body';

const PREFIX = 'seasonal.';
const SEP = ' — ';
const SHIPPED = en as Record<string, string | undefined>;

export function seasonalMessageKey(pluginId: string, rowKey: string, part: SeasonalPart): string {
  return `${PREFIX}${pluginId}.${rowKey}.${part}`;
}

/** The shipped English of one row's title or body, if the catalog has it. */
export function shippedSeasonalText(
  pluginId: string,
  rowKey: string,
  part: SeasonalPart
): string | undefined {
  return SHIPPED[seasonalMessageKey(pluginId, rowKey, part)];
}

function translating(locale: string | null | undefined): locale is string {
  return !!locale && locale !== 'en';
}

/** A row's title or body in `locale`, while it is still the shipped English. */
export function seasonalRowText(
  pluginId: string | null | undefined,
  rowKey: string | null | undefined,
  part: SeasonalPart,
  shown: string,
  locale: string | null | undefined
): string {
  if (!translating(locale) || !pluginId || !rowKey) return shown;
  const key = seasonalMessageKey(pluginId, rowKey, part);
  if (SHIPPED[key] === undefined || SHIPPED[key] !== shown) return shown;
  return t(locale, key as MessageKey);
}

let keyByEnglish: Map<string, string> | null = null;

/** Shipped English → its first message key. A test keeps one English text
 *  to one Spanish text, so the first key is as good as any. */
function byEnglish(): Map<string, string> {
  if (keyByEnglish) return keyByEnglish;
  const map = new Map<string, string>();
  for (const [key, text] of Object.entries(SHIPPED)) {
    if (!key.startsWith(PREFIX) || text === undefined || map.has(text)) continue;
    map.set(text, key);
  }
  keyByEnglish = map;
  return map;
}

/** Any seasonal row's shipped English, matched by text alone: for task
 *  rows that only carry a `derived:` key. Other text comes back as is. */
export function seasonalTextByEnglish(shown: string, locale: string | null | undefined): string {
  if (!translating(locale)) return shown;
  const key = byEnglish().get(shown);
  return key ? t(locale, key as MessageKey) : shown;
}

/** A title written as `<row title> — <crop>` (calendar suggestions and the
 *  tasks scheduled from them), with both halves in `locale` while the row
 *  title is still the shipped English. */
export function seasonalTitleWithCrop(
  shown: string,
  locale: string | null | undefined,
  match?: { pluginId: string; rowKey: string; crop: string; cropShown: string }
): string {
  if (!translating(locale)) return shown;
  if (match) {
    const english = shippedSeasonalText(match.pluginId, match.rowKey, 'title');
    if (english === undefined || shown !== `${english}${SEP}${match.crop}`) return shown;
    return `${t(locale, seasonalMessageKey(match.pluginId, match.rowKey, 'title') as MessageKey)}${SEP}${match.cropShown}`;
  }
  const at = shown.lastIndexOf(SEP);
  if (at <= 0) return seasonalTextByEnglish(shown, locale);
  const head = shown.slice(0, at);
  const key = byEnglish().get(head);
  if (!key || !key.endsWith('.title')) return shown;
  const crop = shown.slice(at + SEP.length);
  return `${t(locale, key as MessageKey)}${SEP}${cropDisplayNameByEnglish(crop, locale)}`;
}
