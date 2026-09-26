import {
  LOUDOUN_DEFAULT_FIRST_FROST_MMDD,
  LOUDOUN_DEFAULT_LAST_FROST_MMDD
} from '$lib/schedule/constants';

export const FROST_LOOKUP_MAX_MI = 50;
const EARTH_RADIUS_MI = 3958.7613;
const FT_PER_M = 3.28084;

/** [id, name, lat, lon, elevM, spring32P50, fall32P50, spring32P10, fall32P10,
 *  spring24P50, fall24P50, spring24P10, fall24P10, frostFree?, extremeMinF?]
 *  with day-of-year (non-leap, Jan 1 = 1) or null. `frostFree` is 1 or 0 and
 *  `extremeMinF` the 1991-2020 mean annual extreme minimum in °F. */
export type FrostStationRow = readonly (string | number | null)[];

export interface FrostDataset {
  version?: string;
  stations: readonly FrostStationRow[];
}

export type FrostProbability = 'median' | 'cautious';

export interface FrostDateSet {
  lastFrost: string | null;
  firstFrost: string | null;
  lastHardFrost: string | null;
  firstHardFrost: string | null;
}

export interface FrostStation {
  id: string;
  name: string;
  distanceMi: number;
  elevM: number | null;
  elevDeltaFt?: number;
}

export interface FrostLookupData extends FrostDateSet {
  provenance: 'data';
  probability: FrostProbability;
  station: FrostStation;
  frostFree: boolean;
  /** The chosen last-spring 32 °F date falls on or after the first-fall one
   *  in day-of-year terms: the frost season spans Dec/Jan, which a single
   *  calendar year's MM-DD pair cannot represent. */
  crossesYear: boolean;
  median: FrostDateSet;
  cautious: FrostDateSet;
}

export type FrostFallbackReason = 'no-location' | 'no-dataset' | 'no-station';

export interface FrostLookupFallback {
  provenance: 'fallback';
  probability: FrostProbability;
  reason: FrostFallbackReason;
  station: null;
  frostFree: false;
  crossesYear: false;
  lastFrost: string;
  firstFrost: string;
  lastHardFrost: null;
  firstHardFrost: null;
}

export type FrostLookupResult = FrostLookupData | FrostLookupFallback;

export interface FrostLookupOptions {
  probability?: FrostProbability;
  maxDistanceMi?: number;
  /** Pin elevation, when known; adds `elevDeltaFt` to the station. */
  elevationFt?: number | null;
  /** Skip stations whose elevation differs from the pin by more than this. */
  maxElevDeltaFt?: number;
}

const COL = {
  id: 0,
  name: 1,
  lat: 2,
  lon: 3,
  elevM: 4,
  spring32P50: 5,
  fall32P50: 6,
  spring32P10: 7,
  fall32P10: 8,
  spring24P50: 9,
  fall24P50: 10,
  spring24P10: 11,
  fall24P10: 12,
  frostFree: 13,
  extremeMinF: 14
} as const;

const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

/** Day of a non-leap year (1..365) → `MM-DD`; out of range → null. */
export function dayOfYearToMmDd(doy: number | null | undefined): string | null {
  if (doy == null || !Number.isInteger(doy) || doy < 1 || doy > 365) return null;
  let m = 0;
  while (doy > CUM_DAYS[m + 1]) m++;
  const d = doy - CUM_DAYS[m];
  return `${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.atan2(Math.sqrt(a), Math.sqrt(1 - Math.min(1, a)));
}

function num(row: FrostStationRow, i: number): number | null {
  const v = row[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function validPoint(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export interface NearestStation {
  row: FrostStationRow;
  distanceMi: number;
}

/** Nearest station within `maxDistanceMi`, or null. Ties break on station id. */
export function nearestFrostStation(
  dataset: FrostDataset,
  lat: number,
  lon: number,
  opts: Pick<FrostLookupOptions, 'maxDistanceMi' | 'elevationFt' | 'maxElevDeltaFt'> & {
    accept?: (row: FrostStationRow) => boolean;
  } = {}
): NearestStation | null {
  if (!validPoint(lat, lon)) return null;
  const maxMi = opts.maxDistanceMi ?? FROST_LOOKUP_MAX_MI;
  const latSlack = maxMi / 69 + 0.01;
  let best: NearestStation | null = null;
  for (const row of dataset.stations) {
    const sLat = num(row, COL.lat);
    const sLon = num(row, COL.lon);
    if (sLat === null || sLon === null) continue;
    if (Math.abs(sLat - lat) > latSlack) continue;
    if (opts.accept && !opts.accept(row)) continue;
    if (opts.elevationFt != null && opts.maxElevDeltaFt != null) {
      const elevM = num(row, COL.elevM);
      if (elevM !== null && Math.abs(elevM * FT_PER_M - opts.elevationFt) > opts.maxElevDeltaFt) {
        continue;
      }
    }
    const d = haversineMi(lat, lon, sLat, sLon);
    if (d > maxMi) continue;
    if (
      !best ||
      d < best.distanceMi ||
      (d === best.distanceMi && String(row[COL.id]) < String(best.row[COL.id]))
    ) {
      best = { row, distanceMi: d };
    }
  }
  return best;
}

/** The station's 1991-2020 mean annual extreme minimum (°F), or null. */
export function stationExtremeMinF(row: FrostStationRow): number | null {
  return num(row, COL.extremeMinF);
}

export function frostStationFromRow(
  row: FrostStationRow,
  distanceMi: number,
  elevationFt?: number | null
): FrostStation {
  const elevM = num(row, COL.elevM);
  const station: FrostStation = {
    id: String(row[COL.id]),
    name: String(row[COL.name] ?? row[COL.id]),
    distanceMi: Math.round(distanceMi * 10) / 10,
    elevM
  };
  if (elevationFt != null && elevM !== null) {
    station.elevDeltaFt = Math.round(elevM * FT_PER_M - elevationFt);
  }
  return station;
}

export function fallbackFrost(
  reason: FrostFallbackReason,
  probability: FrostProbability = 'median'
): FrostLookupFallback {
  return {
    provenance: 'fallback',
    probability,
    reason,
    station: null,
    frostFree: false,
    crossesYear: false,
    lastFrost: LOUDOUN_DEFAULT_LAST_FROST_MMDD,
    firstFrost: LOUDOUN_DEFAULT_FIRST_FROST_MMDD,
    lastHardFrost: null,
    firstHardFrost: null
  };
}

function dateSet(row: FrostStationRow, cautious: boolean): FrostDateSet {
  const d = (i: number) => dayOfYearToMmDd(num(row, i));
  return cautious
    ? {
        lastFrost: d(COL.spring32P10),
        firstFrost: d(COL.fall32P10),
        lastHardFrost: d(COL.spring24P10),
        firstHardFrost: d(COL.fall24P10)
      }
    : {
        lastFrost: d(COL.spring32P50),
        firstFrost: d(COL.fall32P50),
        lastHardFrost: d(COL.spring24P50),
        firstHardFrost: d(COL.fall24P50)
      };
}

/**
 * Pure lookup. NOAA's FPxx columns give the date with an xx% chance the
 * frost event falls *after* it, so "cautious" (90% sure of being clear of
 * frost) reads the P10 columns for both spring and fall.
 */
export function lookupFrostInDataset(
  dataset: FrostDataset | null,
  lat: number | null | undefined,
  lon: number | null | undefined,
  opts: FrostLookupOptions = {}
): FrostLookupResult {
  const probability = opts.probability ?? 'median';
  if (!validPoint(lat, lon)) return fallbackFrost('no-location', probability);
  if (!dataset || dataset.stations.length === 0) return fallbackFrost('no-dataset', probability);
  const hit = nearestFrostStation(dataset, lat, lon as number, opts);
  if (!hit) return fallbackFrost('no-station', probability);
  const { row } = hit;
  const station = frostStationFromRow(row, hit.distanceMi, opts.elevationFt);
  const median = dateSet(row, false);
  const cautious = dateSet(row, true);
  const chosen = probability === 'cautious' ? cautious : median;
  const springCol = probability === 'cautious' ? COL.spring32P10 : COL.spring32P50;
  const fallCol = probability === 'cautious' ? COL.fall32P10 : COL.fall32P50;
  const spring = num(row, springCol);
  const fall = num(row, fallCol);
  return {
    provenance: 'data',
    probability,
    station,
    frostFree: row[COL.frostFree] === 1,
    crossesYear: spring !== null && fall !== null && spring >= fall,
    median,
    cautious,
    ...chosen
  };
}

let datasetPromise: Promise<FrostDataset | null> | null = null;

/** Lazily loads the bundled station table as its own chunk. Resolves null on failure. */
export function loadFrostDataset(): Promise<FrostDataset | null> {
  datasetPromise ??= import('./data/frost-normals-us.json')
    .then((m) => (m.default as unknown as FrostDataset) ?? null)
    .catch(() => {
      datasetPromise = null;
      return null;
    });
  return datasetPromise;
}

export async function lookupFrostDates(
  lat: number | null | undefined,
  lon: number | null | undefined,
  opts: FrostLookupOptions = {}
): Promise<FrostLookupResult> {
  if (!validPoint(lat, lon)) return fallbackFrost('no-location', opts.probability);
  return lookupFrostInDataset(await loadFrostDataset(), lat, lon, opts);
}

/** "Dulles Intl AP, VA · 6 mi" style label for provenance detail text. */
export function frostStationLabel(station: FrostStation): string {
  const mi =
    station.distanceMi < 1 ? '<1 mi' : `${Math.round(station.distanceMi).toLocaleString()} mi`;
  return `${station.name} · ${mi}`;
}
