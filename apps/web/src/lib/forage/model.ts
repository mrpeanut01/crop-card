/** Client-safe forage test vocabulary (Phase 33C, C4). */

import { t } from '$lib/i18n';

/** The four ways labs report nitrate. Mirrors `NITRATE_UNITS` in the DB
 *  schema (kept separate so this module stays out of the server bundle). */
export const FORAGE_NITRATE_UNITS = [
  'ppm-nitrate',
  'ppm-nitrate-n',
  'pct-nitrate',
  'pct-kno3'
] as const;
export type NitrateUnits = (typeof FORAGE_NITRATE_UNITS)[number];

export const NITRATE_UNIT_LABELS: Readonly<Record<NitrateUnits, string>> = {
  'ppm-nitrate': 'ppm nitrate (NO3)',
  'ppm-nitrate-n': 'ppm nitrate-nitrogen (NO3-N)',
  'pct-nitrate': '% nitrate (NO3)',
  'pct-kno3': '% potassium nitrate (KNO3)'
};

export function nitrateUnitLabel(u: NitrateUnits, locale?: string | null): string {
  return locale ? t(locale, `forage.unit.${u}`) : NITRATE_UNIT_LABELS[u];
}

export const RATING_BASES = ['dry-matter', 'as-fed', 'not-stated'] as const;
export type RatingBasis = (typeof RATING_BASES)[number];

export const RATING_BASIS_LABELS: Readonly<Record<RatingBasis, string>> = {
  'dry-matter': 'dry matter basis',
  'as-fed': 'as-fed basis',
  'not-stated': 'basis not stated'
};

export function ratingBasisLabel(b: RatingBasis, locale?: string | null): string {
  return locale ? t(locale, `forage.basis.${b}`) : RATING_BASIS_LABELS[b];
}

/** The lab's own words, stored as typed (M-58). */
export interface ForageLabRating {
  nitrate?: string;
  hcn?: string;
  basis?: RatingBasis;
}

export const FORAGE_LAB_MAX = 120;
export const FORAGE_RATING_MAX = 80;
export const FORAGE_NITRATE_MAX = 1_000_000;
export const FORAGE_HCN_MAX = 100_000;

/** Parses the stored rating JSON. Anything malformed reads as no rating. */
export function parseLabRating(json: string | null | undefined): ForageLabRating | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return null;
    const out: ForageLabRating = {};
    if (typeof raw.nitrate === 'string' && raw.nitrate) out.nitrate = raw.nitrate;
    if (typeof raw.hcn === 'string' && raw.hcn) out.hcn = raw.hcn;
    if (typeof raw.basis === 'string' && (RATING_BASES as readonly string[]).includes(raw.basis)) {
      out.basis = raw.basis as RatingBasis;
    }
    return out.nitrate || out.hcn || out.basis ? out : null;
  } catch {
    return null;
  }
}
