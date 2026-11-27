import { DEFAULT_LOCALE, isKnownLocale, t, type MessageKey } from '$lib/i18n';
import { formatQuantity, type Prefs } from '$lib/prefs';
import { slopeBand, surveySlopePct, type SlopeBand } from './siting';
import type { DrainageClass, SoilComponent, SoilLine, SoilSurvey } from './types';

/**
 * Plain-word lines for a soil survey. Every value is the survey's own data;
 * the notes only restate it in everyday words. Without a locale the result is
 * English.
 */

export interface DescribeSoilOptions {
  locale?: string | null;
  units: Prefs['units'];
}

export type TextureClass =
  | 'sand'
  | 'loamy-sand'
  | 'sandy-loam'
  | 'loam'
  | 'silt-loam'
  | 'silt'
  | 'sandy-clay-loam'
  | 'clay-loam'
  | 'silty-clay-loam'
  | 'sandy-clay'
  | 'silty-clay'
  | 'clay'
  | 'organic';

// Longest names first, so "silty clay loam" is never read as "clay loam".
const TEXTURE_WORDS: Array<[words: string, cls: TextureClass]> = [
  ['silty clay loam', 'silty-clay-loam'],
  ['sandy clay loam', 'sandy-clay-loam'],
  ['silty clay', 'silty-clay'],
  ['sandy clay', 'sandy-clay'],
  ['clay loam', 'clay-loam'],
  ['silt loam', 'silt-loam'],
  ['sandy loam', 'sandy-loam'],
  ['loamy sand', 'loamy-sand'],
  ['loam', 'loam'],
  ['clay', 'clay'],
  ['silt', 'silt'],
  ['sand', 'sand'],
  ['muck', 'organic'],
  ['peat', 'organic']
];

/** The basic texture class inside NRCS texture words such as "Very gravelly
 *  fine sandy loam", or null when none is named. */
export function textureClassOf(texture: string | null | undefined): TextureClass | null {
  if (!texture) return null;
  const words = ` ${texture
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .replace(/\b(very|fine|coarse|medium)\b/g, ' ')
    .replace(/ +/g, ' ')
    .trim()} `;
  for (const [name, cls] of TEXTURE_WORDS) if (words.includes(` ${name} `)) return cls;
  return null;
}

const TEXTURE_KEY: Record<TextureClass, [name: MessageKey, note: MessageKey]> = {
  sand: ['soil.texture.sand', 'soil.texture.sand.note'],
  'loamy-sand': ['soil.texture.loamySand', 'soil.texture.loamySand.note'],
  'sandy-loam': ['soil.texture.sandyLoam', 'soil.texture.sandyLoam.note'],
  loam: ['soil.texture.loam', 'soil.texture.loam.note'],
  'silt-loam': ['soil.texture.siltLoam', 'soil.texture.siltLoam.note'],
  silt: ['soil.texture.silt', 'soil.texture.silt.note'],
  'sandy-clay-loam': ['soil.texture.sandyClayLoam', 'soil.texture.sandyClayLoam.note'],
  'clay-loam': ['soil.texture.clayLoam', 'soil.texture.clayLoam.note'],
  'silty-clay-loam': ['soil.texture.siltyClayLoam', 'soil.texture.siltyClayLoam.note'],
  'sandy-clay': ['soil.texture.sandyClay', 'soil.texture.sandyClay.note'],
  'silty-clay': ['soil.texture.siltyClay', 'soil.texture.siltyClay.note'],
  clay: ['soil.texture.clay', 'soil.texture.clay.note'],
  organic: ['soil.texture.organic', 'soil.texture.organic.note']
};

const DRAINAGE_KEY: Record<DrainageClass, [name: MessageKey, note: MessageKey]> = {
  excessively: ['soil.drainage.excessively', 'soil.drainage.excessively.note'],
  'somewhat-excessively': [
    'soil.drainage.somewhatExcessively',
    'soil.drainage.somewhatExcessively.note'
  ],
  well: ['soil.drainage.well', 'soil.drainage.well.note'],
  'moderately-well': ['soil.drainage.moderatelyWell', 'soil.drainage.moderatelyWell.note'],
  'somewhat-poorly': ['soil.drainage.somewhatPoorly', 'soil.drainage.somewhatPoorly.note'],
  poorly: ['soil.drainage.poorly', 'soil.drainage.poorly.note'],
  'very-poorly': ['soil.drainage.veryPoorly', 'soil.drainage.veryPoorly.note']
};

const SLOPE_KEY: Record<SlopeBand, MessageKey> = {
  flat: 'soil.slope.flat',
  gentle: 'soil.slope.gentle',
  moderate: 'soil.slope.moderate',
  steep: 'soil.slope.steep',
  'very-steep': 'soil.slope.verySteep'
};

const FLOOD_KEY: Record<string, MessageKey> = {
  none: 'soil.flood.none',
  'very rare': 'soil.flood.veryRare',
  rare: 'soil.flood.rare',
  occasional: 'soil.flood.occasional',
  frequent: 'soil.flood.frequent',
  'very frequent': 'soil.flood.veryFrequent'
};

const FARMLAND_KEY: Record<string, MessageKey> = {
  'not prime farmland': 'soil.farmland.notPrime',
  'all areas are prime farmland': 'soil.farmland.allPrime',
  'farmland of statewide importance': 'soil.farmland.statewide',
  'farmland of local importance': 'soil.farmland.local',
  'farmland of unique importance': 'soil.farmland.unique'
};

function n(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/** A survey depth: inches (feet from three feet down) for US units, cm for metric. */
export function formatSoilDepth(cm: number, opts: DescribeSoilOptions): string {
  const inches = cm / 2.54;
  if (opts.units === 'metric') {
    return formatQuantity(
      inches,
      'length',
      { units: 'metric' },
      { digits: 0, locale: opts.locale }
    );
  }
  if (inches < 36) {
    return formatQuantity(inches, 'length', { units: 'us' }, { digits: 0, locale: opts.locale });
  }
  return formatQuantity(
    inches / 12,
    'distance',
    { units: 'us' },
    { digits: 1, locale: opts.locale }
  );
}

function isEnglish(locale: string | null | undefined): boolean {
  return !isKnownLocale(locale) || locale === DEFAULT_LOCALE;
}

/** A known NRCS phrase in the reader's language; anything else as the survey wrote it. */
function nrcsWords(
  words: string,
  table: Record<string, MessageKey>,
  locale: string | null | undefined
): string {
  const key = table[words.trim().toLowerCase()];
  return key && !isEnglish(locale) ? t(locale, key) : words;
}

function topLayer(survey: SoilSurvey): SoilComponent | null {
  return (
    survey.components.find((c) => c.surfaceTexture !== null) ??
    survey.components.find((c) => c.ph !== null || c.organicMatterPct !== null) ??
    null
  );
}

function phValue(ph: NonNullable<SoilComponent['ph']>, locale?: string | null): string | null {
  const low = ph.low === null ? null : ph.low.toFixed(1);
  const high = ph.high === null ? null : ph.high.toFixed(1);
  const typical = ph.typical === null ? null : ph.typical.toFixed(1);
  if (low !== null && high !== null && typical !== null) {
    return t(locale, 'soil.value.phRangeTypical', { low, high, typical });
  }
  if (low !== null && high !== null) return t(locale, 'soil.value.phRange', { low, high });
  const one = typical ?? low ?? high;
  return one === null ? null : t(locale, 'soil.value.phTypical', { typical: one });
}

export function describeSoil(survey: SoilSurvey, opts: DescribeSoilOptions): SoilLine[] {
  const locale = opts.locale;
  const lines: SoilLine[] = [];
  const add = (id: SoilLine['id'], label: MessageKey, value: string, note?: string) =>
    lines.push({
      id,
      label: t(locale, label),
      value,
      ...(note ? { note } : {}),
      provenance: 'data'
    });

  const named = survey.components.filter((c) => c.percent !== null);
  add(
    'name',
    'soil.line.name',
    survey.mapUnitName,
    named.length > 0
      ? t(locale, 'soil.line.name.note', {
          list: named
            .map((c) =>
              t(locale, 'soil.value.component', { name: c.name, percent: n(c.percent ?? 0, 0) })
            )
            .join(', ')
        })
      : undefined
  );

  const top = survey.notSoil ? null : topLayer(survey);

  if (top?.surfaceTexture) {
    const cls = textureClassOf(top.surfaceTexture);
    if (!cls) add('texture', 'soil.line.texture', top.surfaceTexture);
    else {
      const [nameKey, noteKey] = TEXTURE_KEY[cls];
      const translated = t(locale, nameKey);
      const exact = top.surfaceTexture.trim().toLowerCase() === t(null, nameKey).toLowerCase();
      const value = isEnglish(locale)
        ? top.surfaceTexture
        : exact
          ? translated
          : `${translated} (${top.surfaceTexture})`;
      add('texture', 'soil.line.texture', value, t(locale, noteKey));
    }
  }

  const drainage = survey.notSoil
    ? null
    : (survey.drainageClass ?? survey.components[0]?.drainageClass ?? null);
  if (drainage) {
    const [nameKey, noteKey] = DRAINAGE_KEY[drainage];
    add('drainage', 'soil.line.drainage', t(locale, nameKey), t(locale, noteKey));
  }

  const slope = surveySlopePct(survey);
  if (slope !== null) {
    add(
      'slope',
      'soil.line.slope',
      t(locale, 'soil.value.slope', {
        words: t(locale, SLOPE_KEY[slopeBand(slope)]),
        pct: n(slope, 0)
      })
    );
  }

  if (!survey.notSoil) {
    add(
      'water-table',
      'soil.line.waterTable',
      survey.waterTableDepthCm === null
        ? t(locale, 'soil.value.noneNoted')
        : t(locale, 'soil.value.depthAbout', {
            depth: formatSoilDepth(survey.waterTableDepthCm, opts)
          })
    );
    add(
      'bedrock',
      'soil.line.bedrock',
      survey.bedrockDepthCm === null
        ? t(locale, 'soil.value.noneNoted')
        : t(locale, 'soil.value.depthAbout', {
            depth: formatSoilDepth(survey.bedrockDepthCm, opts)
          })
    );
    if (survey.floodFrequency) {
      add('flooding', 'soil.line.flooding', nrcsWords(survey.floodFrequency, FLOOD_KEY, locale));
    }
  }

  if (top?.ph) {
    const value = phValue(top.ph, locale);
    if (value) add('ph', 'soil.line.ph', value, t(locale, 'soil.line.ph.note'));
  }
  if (top && top.organicMatterPct !== null) {
    add(
      'organic-matter',
      'soil.line.om',
      t(locale, 'soil.value.percent', { n: n(top.organicMatterPct, 2) }),
      t(locale, 'soil.line.om.note')
    );
  }

  if (survey.farmlandClass) {
    add('farmland', 'soil.line.farmland', nrcsWords(survey.farmlandClass, FARMLAND_KEY, locale));
  }

  return lines;
}
