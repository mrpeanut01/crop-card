import { normalizeFrost } from '$lib/schedule/farmLocation';
import { frostStationLabel, type FrostLookupResult } from './frostNormals';

export type FrostValueProvenance = 'data' | 'manual' | 'fallback';

export interface FrostSuggestedValue {
  value: string | null;
  provenance: FrostValueProvenance;
}

export type FrostField = 'lastFrost' | 'firstFrost' | 'lastHardFrost' | 'firstHardFrost';

export const FROST_FIELDS: readonly FrostField[] = [
  'lastFrost',
  'firstFrost',
  'lastHardFrost',
  'firstHardFrost'
];

export type FrostOverride = Partial<Record<FrostField, unknown>>;

export interface FrostSuggestion {
  values: Record<FrostField, FrostSuggestedValue>;
  /** Station name + distance for `data`; null otherwise. */
  sourceLabel: string | null;
  frostFree: boolean;
  /** Station normals put the last spring frost on or after the first fall one
   *  (a Dec/Jan frost season); the owner should confirm or edit before saving. */
  crossesYear: boolean;
  /** Why the defaults were used, when they were. */
  fallbackReason: string | null;
}

function canonicalMmDd(raw: unknown): string | null {
  const v = normalizeFrost(raw);
  if (!v) return null;
  const [m, d] = v.split('-');
  return `${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const FALLBACK_REASON: Record<string, string> = {
  'no-location': 'Set your farm location to look up frost dates.',
  'no-dataset': "Frost normals couldn't load; using Loudoun defaults.",
  'no-station': 'No weather station within 50 miles; using Loudoun defaults.'
};

/**
 * Turns a frost lookup plus whatever the owner typed into the values to save.
 * A typed value that differs from the suggestion is `manual`; one that matches
 * keeps the suggestion's provenance, so confirming a date never relabels it.
 */
export function suggestFrostValues(
  lookup: FrostLookupResult,
  override: FrostOverride = {}
): FrostSuggestion {
  const base = lookup.provenance;
  const values = {} as Record<FrostField, FrostSuggestedValue>;
  for (const field of FROST_FIELDS) {
    const suggested = lookup[field];
    const typed = override[field] === undefined ? undefined : canonicalMmDd(override[field]);
    if (typed && typed !== suggested) {
      values[field] = { value: typed, provenance: 'manual' };
    } else {
      values[field] = { value: suggested, provenance: base };
    }
  }
  return {
    values,
    sourceLabel: lookup.station ? frostStationLabel(lookup.station) : null,
    frostFree: lookup.frostFree,
    crossesYear:
      lookup.crossesYear &&
      values.lastFrost.provenance === 'data' &&
      values.firstFrost.provenance === 'data',
    fallbackReason:
      lookup.provenance === 'fallback' ? (FALLBACK_REASON[lookup.reason] ?? null) : null
  };
}
