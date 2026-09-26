/**
 * Frost dates as saved per Owner (Phase 30). Client-safe: the onboarding
 * screen, /settings/farm and their server actions share the same rules for
 * what gets saved, with which provenance, and when the owner has to confirm
 * before anything is written.
 */

import {
  LOUDOUN_DEFAULT_FIRST_FROST_MMDD,
  LOUDOUN_DEFAULT_LAST_FROST_MMDD
} from '$lib/schedule/constants';
import { normalizeFrost } from '$lib/schedule/farmLocation';
import type { FrostProbability } from './frostNormals';
import {
  FROST_FIELDS,
  type FrostField,
  type FrostOverride,
  type FrostOverrideIssue,
  type FrostSuggestedValue,
  type FrostSuggestion,
  type FrostValueProvenance
} from './frostSuggest';

export type StoredFrostDates = Record<FrostField, string | null>;

export interface StoredFrostProvenance {
  values: Partial<Record<FrostField, FrostValueProvenance>>;
  /** Station label when any value came from the station table. */
  source: string | null;
  probability: FrostProbability | null;
}

export const EMPTY_FROST_PROVENANCE: StoredFrostProvenance = {
  values: {},
  source: null,
  probability: null
};

const PROVENANCES: readonly FrostValueProvenance[] = ['data', 'manual', 'fallback'];

export function parseFrostProvenance(raw: string | null | undefined): StoredFrostProvenance {
  if (!raw) return EMPTY_FROST_PROVENANCE;
  try {
    const v = JSON.parse(raw) as Partial<{
      values: Record<string, unknown>;
      source: unknown;
      probability: unknown;
    }>;
    const values: StoredFrostProvenance['values'] = {};
    for (const f of FROST_FIELDS) {
      const p = v.values?.[f];
      if (typeof p === 'string' && (PROVENANCES as readonly string[]).includes(p)) {
        values[f] = p as FrostValueProvenance;
      }
    }
    return {
      values,
      source: typeof v.source === 'string' && v.source ? v.source.slice(0, 200) : null,
      probability: v.probability === 'median' || v.probability === 'cautious' ? v.probability : null
    };
  } catch {
    return EMPTY_FROST_PROVENANCE;
  }
}

/**
 * What a stored date shows as. A date saved before provenance existed was
 * typed by the owner; a missing last or first frost date is the Loudoun
 * default the planner falls back to.
 */
export function storedFrostView(
  dates: StoredFrostDates,
  prov: StoredFrostProvenance
): Record<FrostField, FrostSuggestedValue> {
  const out = {} as Record<FrostField, FrostSuggestedValue>;
  for (const f of FROST_FIELDS) {
    const value = dates[f];
    if (value) {
      out[f] = { value, provenance: prov.values[f] ?? 'manual' };
    } else if (f === 'lastFrost') {
      out[f] = { value: LOUDOUN_DEFAULT_LAST_FROST_MMDD, provenance: 'fallback' };
    } else if (f === 'firstFrost') {
      out[f] = { value: LOUDOUN_DEFAULT_FIRST_FROST_MMDD, provenance: 'fallback' };
    } else {
      out[f] = { value: null, provenance: prov.values[f] ?? 'fallback' };
    }
  }
  return out;
}

/**
 * Compare what the form posted with the stored view: unchanged keeps its
 * provenance, a changed or cleared value becomes `manual`, an unreadable one
 * keeps the stored value and is reported.
 */
export function suggestFromStored(
  view: Record<FrostField, FrostSuggestedValue>,
  override: FrostOverride,
  source: string | null
): FrostSuggestion {
  const values = {} as Record<FrostField, FrostSuggestedValue>;
  const issues: FrostOverrideIssue[] = [];
  for (const f of FROST_FIELDS) {
    const current = view[f];
    const raw = override[f];
    if (raw === undefined) {
      values[f] = current;
      continue;
    }
    const input = raw === null ? '' : String(raw).trim();
    if (!input) {
      values[f] = current.value === null ? current : { value: null, provenance: 'manual' };
      continue;
    }
    const typed = normalizeFrost(input);
    if (!typed) {
      values[f] = { ...current, invalid: true };
      issues.push({ field: f, input, message: `"${input}" isn't a date. Use MM-DD or M/D.` });
    } else {
      values[f] = typed === current.value ? current : { value: typed, provenance: 'manual' };
    }
  }
  return {
    values,
    sourceLabel: source,
    frostFree: false,
    crossesYear: false,
    fallbackReason: null,
    issues,
    basis: 'stored'
  };
}

export type FrostConfirmReason = 'fallback' | 'frost-free' | 'missing' | 'crosses-year';

/**
 * Whether the owner must confirm before these values are saved. Nothing is
 * ever saved blank for the spring or fall date without a yes, because blank
 * silently means "use Loudoun's dates" to every planner.
 */
export function frostConfirmReason(s: FrostSuggestion): FrostConfirmReason | null {
  const last = s.values.lastFrost;
  const first = s.values.firstFrost;
  if (last.value === null || first.value === null) return s.frostFree ? 'frost-free' : 'missing';
  if (s.crossesYear) return 'crosses-year';
  if (s.basis !== 'stored' && last.provenance === 'fallback' && first.provenance === 'fallback') {
    return 'fallback';
  }
  return null;
}

/** Stored dates that are still the Loudoun defaults, with no station lookup
 *  behind them. */
export const FROST_STORED_FALLBACK_COPY =
  'These are the Loudoun County averages. Tap Suggest from my location to use the nearest weather station.';

export const FROST_CONFIRM_COPY: Record<FrostConfirmReason, string> = {
  fallback:
    "We couldn't find a weather station within 50 miles, so these are the Loudoun County averages. Check them against your county extension office, or keep them for now.",
  'frost-free':
    'The nearest station almost never records frost. The planting calendar still needs a spring and a fall date, so type your own, or keep the Loudoun County averages for now.',
  missing:
    'The planting calendar needs a spring and a fall frost date. Type them in, or keep the Loudoun County averages for now.',
  'crosses-year':
    'At this station the frost season runs across the new year, so these dates may read oddly. Check them, change them if you need to, and confirm.'
};

export interface FrostSavePlan {
  set: Partial<Record<FrostField, string>>;
  clear: FrostField[];
  provenance: StoredFrostProvenance;
}

export type FrostSaveResult =
  | { ok: true; plan: FrostSavePlan | null }
  | { ok: false; error: string; reason?: FrostConfirmReason };

export function planFrostSave(
  s: FrostSuggestion,
  opts: { confirmed: boolean; probability: FrostProbability | null }
): FrostSaveResult {
  if (s.issues.length > 0) return { ok: false, error: s.issues.map((i) => i.message).join(' ') };
  const reason = frostConfirmReason(s);
  if (reason && !opts.confirmed) {
    return { ok: false, error: FROST_CONFIRM_COPY[reason], reason };
  }
  const values = { ...s.values };
  if (values.lastFrost.value === null) {
    values.lastFrost = { value: LOUDOUN_DEFAULT_LAST_FROST_MMDD, provenance: 'fallback' };
  }
  if (values.firstFrost.value === null) {
    values.firstFrost = { value: LOUDOUN_DEFAULT_FIRST_FROST_MMDD, provenance: 'fallback' };
  }
  const set: FrostSavePlan['set'] = {};
  const clear: FrostField[] = [];
  const prov: StoredFrostProvenance['values'] = {};
  for (const f of FROST_FIELDS) {
    const v = values[f];
    if (v.value) set[f] = v.value;
    else clear.push(f);
    prov[f] = v.provenance;
  }
  const usesData = FROST_FIELDS.some((f) => prov[f] === 'data');
  return {
    ok: true,
    plan: {
      set,
      clear,
      provenance: {
        values: prov,
        source: usesData ? s.sourceLabel : null,
        probability: usesData ? opts.probability : null
      }
    }
  };
}

export function readFrostOverride(get: (name: string) => unknown): FrostOverride {
  const out: FrostOverride = {};
  for (const f of FROST_FIELDS) {
    const v = get(f);
    if (v !== null && v !== undefined) out[f] = v;
  }
  return out;
}
