import { normalizeFrost } from '$lib/schedule/farmLocation';
import { frostStationLabel, type FrostLookupResult } from './frostNormals';

export type FrostValueProvenance = 'data' | 'manual' | 'fallback';

export interface FrostSuggestedValue {
  value: string | null;
  provenance: FrostValueProvenance;
  /** The owner typed something that isn't a calendar date; `value` is still
   *  the suggestion so the form can show the error next to it. */
  invalid?: true;
}

export interface FrostOverrideIssue {
  field: FrostField;
  input: string;
  message: string;
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
  /** Typed values that couldn't be read as a date. */
  issues: FrostOverrideIssue[];
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
 * A blank (or null) override clears the date, which is `manual` unless the
 * suggestion was already empty. An unreadable override keeps the suggestion,
 * is flagged `invalid` and listed in `issues`; it is never silently dropped.
 */
export function suggestFrostValues(
  lookup: FrostLookupResult,
  override: FrostOverride = {}
): FrostSuggestion {
  const base = lookup.provenance;
  const values = {} as Record<FrostField, FrostSuggestedValue>;
  const issues: FrostOverrideIssue[] = [];
  for (const field of FROST_FIELDS) {
    const suggested = lookup[field];
    const raw = override[field];
    if (raw === undefined) {
      values[field] = { value: suggested, provenance: base };
      continue;
    }
    const input = raw === null ? '' : String(raw).trim();
    if (!input) {
      values[field] =
        suggested === null
          ? { value: null, provenance: base }
          : { value: null, provenance: 'manual' };
      continue;
    }
    const typed = normalizeFrost(input);
    if (!typed) {
      values[field] = { value: suggested, provenance: base, invalid: true };
      issues.push({ field, input, message: `"${input}" isn't a date. Use MM-DD or M/D.` });
    } else if (typed !== suggested) {
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
      lookup.provenance === 'fallback' ? (FALLBACK_REASON[lookup.reason] ?? null) : null,
    issues
  };
}
