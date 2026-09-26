import type { SnapshotFrostDates } from '$lib/cards/snapshot';
import { deleteSetting, getSetting, setSetting } from '$lib/db/settings';
import { normalizeFrost } from '$lib/schedule/farmLocation';
import { SETTINGS_KEYS, type FarmLatLon } from '$lib/schedule/constants';
import { lookupFrostDates, type FrostProbability } from './frostNormals';
import {
  FROST_FIELDS,
  suggestFrostValues,
  type FrostField,
  type FrostSuggestion
} from './frostSuggest';
import {
  parseFrostProvenance,
  planFrostSave,
  readFrostOverride,
  storedFrostView,
  suggestFromStored,
  type FrostSavePlan,
  type FrostSaveResult,
  type StoredFrostDates,
  type StoredFrostProvenance
} from './frostSettings';

const KEY: Record<FrostField, string> = {
  lastFrost: SETTINGS_KEYS.lastFrost,
  firstFrost: SETTINGS_KEYS.firstFrost,
  lastHardFrost: SETTINGS_KEYS.lastHardFrost,
  firstHardFrost: SETTINGS_KEYS.firstHardFrost
};

export function loadStoredFrost(): { dates: StoredFrostDates; provenance: StoredFrostProvenance } {
  return {
    dates: {
      lastFrost: getSetting(KEY.lastFrost) ?? null,
      firstFrost: getSetting(KEY.firstFrost) ?? null,
      lastHardFrost: getSetting(KEY.lastHardFrost) ?? null,
      firstHardFrost: getSetting(KEY.firstHardFrost) ?? null
    },
    provenance: parseFrostProvenance(getSetting(SETTINGS_KEYS.frostProvenance))
  };
}

/**
 * Saved frost dates as the Card and map snapshots carry them, with one
 * provenance for the spring and fall pair: the shared tag when both agree,
 * `manual` when the owner typed either one, and `fallback` for a station date
 * next to a Loudoun default. A station date is never shown as typed, and a
 * pair of Loudoun defaults never as the owner's own.
 */
export function snapshotFrostFromSettings(): SnapshotFrostDates {
  const stored = loadStoredFrost();
  const dates = {} as StoredFrostDates;
  for (const f of FROST_FIELDS) dates[f] = normalizeFrost(stored.dates[f]);
  const view = storedFrostView(dates, stored.provenance);
  const last = view.lastFrost.provenance;
  const first = view.firstFrost.provenance;
  const provenance =
    last === first ? last : last === 'manual' || first === 'manual' ? 'manual' : 'fallback';
  return {
    lastSpring: view.lastFrost.value,
    firstFall: view.firstFrost.value,
    hardLastSpring: view.lastHardFrost.value,
    hardFirstFall: view.firstHardFrost.value,
    cautious: null,
    frostFree: false,
    provenance,
    stationName: provenance === 'data' ? stored.provenance.source : null,
    distanceMi: null
  };
}

/** A frost date written outside the frost forms (the settings API): the
 *  field becomes `manual` when set and `fallback` when cleared, and the
 *  station label goes once no field is station data. */
export function markFrostField(field: FrostField, provenance: 'manual' | 'fallback'): void {
  const prov = parseFrostProvenance(getSetting(SETTINGS_KEYS.frostProvenance));
  const values = { ...prov.values, [field]: provenance };
  const usesData = FROST_FIELDS.some((f) => values[f] === 'data');
  const next: StoredFrostProvenance = {
    values,
    source: usesData ? prov.source : null,
    probability: usesData ? prov.probability : null
  };
  setSetting(SETTINGS_KEYS.frostProvenance, JSON.stringify(next));
}

export function applyFrostPlan(plan: FrostSavePlan): void {
  for (const [field, value] of Object.entries(plan.set) as Array<[FrostField, string]>) {
    setSetting(KEY[field], value);
  }
  for (const field of plan.clear) deleteSetting(KEY[field]);
  setSetting(SETTINGS_KEYS.frostProvenance, JSON.stringify(plan.provenance));
}

/**
 * Reads the frost part of a form. `frostBasis=lookup` means the values on
 * screen started from the station table at this location, so the lookup is
 * rerun here and provenance is decided server-side; anything else compares
 * against what is already saved.
 */
export async function resolveFrostForm(
  fd: FormData,
  latLon: FarmLatLon | null
): Promise<FrostSaveResult> {
  const probability: FrostProbability =
    fd.get('frostProbability') === 'cautious' ? 'cautious' : 'median';
  const override = readFrostOverride((name) => fd.get(name));
  let suggestion: FrostSuggestion;
  let usedProbability: FrostProbability | null = probability;
  if (fd.get('frostBasis') === 'lookup' && latLon) {
    const lookup = await lookupFrostDates(latLon.lat, latLon.lon, { probability });
    suggestion = suggestFrostValues(lookup, override);
  } else {
    const stored = loadStoredFrost();
    const view = storedFrostView(stored.dates, stored.provenance);
    suggestion = suggestFromStored(view, override, stored.provenance.source);
    const changed = FROST_FIELDS.some((f) => suggestion.values[f] !== view[f]);
    if (!changed && suggestion.issues.length === 0) return { ok: true, plan: null };
    usedProbability = stored.provenance.probability;
  }
  return planFrostSave(suggestion, {
    confirmed: fd.get('frostConfirm') === '1',
    probability: usedProbability
  });
}
