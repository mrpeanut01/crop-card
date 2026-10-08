import { t, type MessageKey } from '$lib/i18n';

const METRIC_KEY: Record<string, MessageKey> = {
  'count-per-leaf': 'recui.metric.countPerLeaf',
  'count-per-plant': 'recui.metric.countPerPlant',
  'count-per-trap-per-week': 'recui.metric.countPerTrapPerWeek',
  'avg-per-10sqft': 'recui.metric.avgPer10SqFt',
  'pct-defoliation': 'recui.metric.pctDefoliation',
  'pct-infested-plants': 'recui.metric.pctInfestedPlants',
  'pct-leaf-area': 'recui.metric.pctLeafArea',
  'percent-leaf-area': 'recui.metric.pctLeafArea',
  'lesion-count-per-leaf': 'recui.metric.lesionCountPerLeaf',
  'plants-infected-pct': 'recui.metric.plantsInfectedPct',
  'eggs-per-plant': 'recui.metric.eggsPerPlant',
  note: 'recui.metric.note'
};

/** The metrics an insecticide label's scouting threshold can use, in the
 *  order a counting form offers them. */
export const PEST_COUNT_METRICS = [
  'count-per-plant',
  'count-per-leaf',
  'count-per-trap-per-week',
  'eggs-per-plant',
  'pct-defoliation',
  'pct-infested-plants'
] as const;
export type PestCountMetric = (typeof PEST_COUNT_METRICS)[number];

const PEST_KEY: Record<string, MessageKey> = {
  'broadleaf-weed': 'recui.pest.broadleafWeed'
};

/** A scout observation's subject as words: app codes ("broadleaf-weed")
 *  are translated, pest names typed by people or plugins stay as written. */
export function scoutPestLabel(pest: string, locale?: string | null): string {
  const key = PEST_KEY[pest];
  return key ? t(locale, key) : pest;
}

/** The farmer's own words in a counted observation's notes
 *  ("spots=[1,2] decision=SKIP note: aphids" → "aphids"). */
export function scoutNoteText(metric: string, notes: string | null | undefined): string | null {
  const raw = (notes ?? '').trim();
  if (!raw) return null;
  if (metric === 'note') return raw;
  const at = raw.indexOf('note: ');
  if (at < 0) return null;
  const text = raw.slice(at + 'note: '.length).trim();
  return text || null;
}

/** A scout or disease metric code ("count-per-leaf") as words. Unknown
 *  codes read as their words with the dashes taken out. */
export function scoutMetricLabel(metric: string, locale?: string | null): string {
  const key = METRIC_KEY[metric];
  if (key) return t(locale, key);
  const s = metric.replace(/[-_]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : t(locale, 'recui.metric.count');
}

/** "aphids · Per leaf: 1.2"; a note-only observation shows its note. */
export function observationLine(
  subject: string,
  metric: string,
  value: number,
  notes: string | null | undefined,
  locale?: string | null
): string {
  const who = locale ? scoutPestLabel(subject.trim(), locale) : subject.trim();
  if (metric === 'note') {
    const text = (notes ?? '').trim();
    const note = text.length > 80 ? `${text.slice(0, 79)}…` : text;
    return [who && who !== 'note' ? who : null, note || t(locale, 'recui.metric.note')]
      .filter(Boolean)
      .join(' · ');
  }
  return [who || null, `${scoutMetricLabel(metric, locale)}: ${value}`].filter(Boolean).join(' · ');
}
