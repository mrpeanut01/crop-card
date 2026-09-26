import {
  FROST_LOOKUP_MAX_MI,
  frostStationFromRow,
  frostStationLabel,
  loadFrostDataset,
  nearestFrostStation,
  stationExtremeMinF,
  type FrostDataset,
  type FrostStation,
  type FrostStationRow
} from './frostNormals';

/**
 * An approximate hardiness zone worked out from one NOAA station's 1991-2020
 * mean annual extreme minimum, using the same 10 °F zones and 5 °F half-zones
 * the USDA map uses. It is not the USDA map (which is gridded PRISM data), it
 * is display-only, and nothing in the app filters, schedules or blocks on it.
 */

export const ZONE_FLOOR_F = -60;
export const ZONE_CEILING_F = 70;
const HALF_ZONE_F = 5;
const LAST_HALF_ZONE = (ZONE_CEILING_F - ZONE_FLOOR_F) / HALF_ZONE_F - 1;
const FT_PER_M = 3.28084;
const ELEV_M_COL = 4;

export interface HardinessZone {
  /** `"7a"` */
  zone: string;
  number: number;
  half: 'a' | 'b';
  /** Half-zone range, lower bound inclusive; the ends are open past 1a and 13b. */
  minF: number;
  maxF: number;
}

/** 0 to <5 °F is 7a, 5 to <10 °F is 7b; colder than -60 °F reads 1a and
 *  70 °F or warmer 13b. Input is rounded to the dataset's 0.1 °F first, so
 *  the half-zone edges are decided in exact integer tenths. Missing or
 *  non-finite input gives null. */
export function zoneFromExtremeMin(extremeMinF: number | null | undefined): HardinessZone | null {
  if (typeof extremeMinF !== 'number' || !Number.isFinite(extremeMinF)) return null;
  const tenths = Math.round(extremeMinF * 10);
  const raw = Math.floor((tenths - ZONE_FLOOR_F * 10) / (HALF_ZONE_F * 10));
  const step = Math.min(Math.max(raw, 0), LAST_HALF_ZONE);
  const number = Math.floor(step / 2) + 1;
  const half = step % 2 === 0 ? 'a' : 'b';
  const minF = ZONE_FLOOR_F + step * HALF_ZONE_F;
  return { zone: `${number}${half}`, number, half, minF, maxF: minF + HALF_ZONE_F };
}

/** Owner-typed zone → normalized `"7a"`, or null for anything else. */
export function parseZone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*(?:zone\s*)?(1[0-3]|[1-9])\s*([ab])\s*$/i.exec(raw);
  return m ? `${Number(m[1])}${m[2].toLowerCase()}` : null;
}

/** `near`: a station within 50 mi. `wide`: nothing qualified within 50 mi,
 *  so the lookup reached out to 100 mi for a station at a similar elevation. */
export type ZoneReach = 'near' | 'wide';

export const ZONE_NEAR_MAX_MI = FROST_LOOKUP_MAX_MI;
export const ZONE_WIDE_MAX_MI = 100;

/**
 * Air cools about 3.6 °F per 1,000 ft (the 6.5 °C/km standard-atmosphere
 * lapse rate) and a half-zone is 5 °F wide, so a station within 1,000 ft of
 * the farm cannot shift the estimate by a full half-zone on elevation alone.
 * When the farm's elevation is known, a station outside that band is never
 * used, in either pass. When it is unknown, only the 50-mile pass runs,
 * unguarded, as it did before the wider pass existed.
 */
export const ZONE_MAX_ELEV_DELTA_FT = 1_000;

/** A plausible ground elevation in feet (below Death Valley to above Denali is rejected), else null. */
export function validElevationFt(ft: unknown): number | null {
  if (typeof ft !== 'number' || !Number.isFinite(ft)) return null;
  return ft >= -1_000 && ft <= 21_000 ? ft : null;
}

/** Station elevation minus farm elevation, in feet; null when either is unknown. */
export function stationElevDeltaFt(
  row: FrostStationRow,
  farmElevationFt: number | null
): number | null {
  const elevM = row[ELEV_M_COL];
  if (farmElevationFt === null || typeof elevM !== 'number' || !Number.isFinite(elevM)) {
    return null;
  }
  return elevM * FT_PER_M - farmElevationFt;
}

function withinElevBand(delta: number | null): boolean {
  return delta !== null && Math.abs(delta) <= ZONE_MAX_ELEV_DELTA_FT;
}

export interface ZoneLookup {
  provenance: 'data';
  zone: HardinessZone;
  extremeMinF: number;
  station: FrostStation;
  reach: ZoneReach;
}

export interface ZoneLookupOptions {
  /** Radius of the first pass; 50 mi unless a test narrows it. */
  maxDistanceMi?: number;
  /** Farm ground elevation. Unknown skips the elevation guard and the wide pass. */
  elevationFt?: number | null;
}

/**
 * First pass: the nearest station with an extreme minimum within 50 miles,
 * skipping any that sits more than 1,000 ft above or below the farm when both
 * elevations are known. Second pass, only when the farm's elevation is known
 * and the first found nothing: the nearest station within 100 miles whose own
 * elevation is known and within 1,000 ft of the farm's. No station, no
 * location or no dataset gives null: there is no fallback zone.
 */
export function lookupZoneInDataset(
  dataset: FrostDataset | null,
  lat: number | null | undefined,
  lon: number | null | undefined,
  opts: ZoneLookupOptions = {}
): ZoneLookup | null {
  if (!dataset || typeof lat !== 'number' || typeof lon !== 'number') return null;
  const farmElev = validElevationFt(opts.elevationFt);
  const hasMin = (row: FrostStationRow) => stationExtremeMinF(row) !== null;

  const near = nearestFrostStation(dataset, lat, lon, {
    maxDistanceMi: opts.maxDistanceMi ?? ZONE_NEAR_MAX_MI,
    accept: (row) => {
      if (!hasMin(row)) return false;
      const delta = stationElevDeltaFt(row, farmElev);
      return delta === null || withinElevBand(delta);
    }
  });
  const hit =
    near ??
    (farmElev === null
      ? null
      : nearestFrostStation(dataset, lat, lon, {
          maxDistanceMi: ZONE_WIDE_MAX_MI,
          accept: (row) => hasMin(row) && withinElevBand(stationElevDeltaFt(row, farmElev))
        }));
  if (!hit) return null;
  const extremeMinF = stationExtremeMinF(hit.row);
  const zone = zoneFromExtremeMin(extremeMinF);
  if (extremeMinF === null || !zone) return null;
  return {
    provenance: 'data',
    zone,
    extremeMinF,
    station: frostStationFromRow(hit.row, hit.distanceMi, farmElev),
    reach: near ? 'near' : 'wide'
  };
}

export async function lookupZone(
  lat: number | null | undefined,
  lon: number | null | undefined,
  opts: ZoneLookupOptions = {}
): Promise<ZoneLookup | null> {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return lookupZoneInDataset(await loadFrostDataset(), lat, lon, opts);
}

/** A farm's zone as screens and Cards show it. `reach` and `elevDeltaFt` are
 *  optional so Card snapshots saved before the wide pass still read. */
export interface FarmZone {
  zone: string;
  provenance: 'data' | 'manual';
  stationName: string | null;
  distanceMi: number | null;
  extremeMinF: number | null;
  reach?: ZoneReach;
  /** Station minus farm elevation, rounded feet, when both are known. */
  elevDeltaFt?: number | null;
}

export function farmZoneFrom(manual: string | null, lookup: ZoneLookup | null): FarmZone | null {
  const typed = parseZone(manual);
  if (typed) {
    return {
      zone: typed,
      provenance: 'manual',
      stationName: null,
      distanceMi: null,
      extremeMinF: null
    };
  }
  if (!lookup) return null;
  return {
    zone: lookup.zone.zone,
    provenance: 'data',
    stationName: lookup.station.name,
    distanceMi: lookup.station.distanceMi,
    extremeMinF: lookup.extremeMinF,
    reach: lookup.reach,
    elevDeltaFt: lookup.station.elevDeltaFt ?? null
  };
}

function isWide(zone: Pick<FarmZone, 'provenance' | 'reach'>): boolean {
  return zone.provenance === 'data' && zone.reach === 'wide';
}

function miles(distanceMi: number): string {
  return `${Math.round(distanceMi).toLocaleString()} mi`;
}

/** "Zone 7a (approx.)" for an estimate, "Zone 7a" for the owner's own. */
export function zoneValueLabel(zone: Pick<FarmZone, 'zone' | 'provenance'>): string {
  return zone.provenance === 'data' ? `Zone ${zone.zone} (approx.)` : `Zone ${zone.zone}`;
}

/** "nearest station 78 mi, similar elevation" for a wide estimate, else null. */
export function zoneReachNote(zone: FarmZone): string | null {
  if (!isWide(zone) || zone.distanceMi === null) return null;
  return `nearest station ${miles(zone.distanceMi)}, similar elevation`;
}

/** The Farm Map Card's Zone value: "7a (approx.)", "6b (approx., station 78 mi)" or "6b". */
export function zoneCardValue(zone: FarmZone): string {
  if (zone.provenance === 'manual') return zone.zone;
  if (isWide(zone) && zone.distanceMi !== null) {
    return `${zone.zone} (approx., station ${miles(zone.distanceMi)})`;
  }
  return `${zone.zone} (approx.)`;
}

/** Provenance detail: "from Washington DC Dulles AP, VA · 6 mi", with
 *  ", similar elevation" added for a wide estimate. */
export function zoneSourceDetail(zone: FarmZone): string | undefined {
  if (zone.provenance === 'manual') return 'your zone';
  if (!zone.stationName) return undefined;
  if (zone.distanceMi === null) return `from ${zone.stationName}`;
  const label = frostStationLabel({
    id: '',
    name: zone.stationName,
    distanceMi: zone.distanceMi,
    elevM: null
  });
  return isWide(zone) ? `from ${label}, similar elevation` : `from ${label}`;
}

export const ZONE_ESTIMATE_LONG =
  "Estimated from the nearest NOAA station's 1991-2020 average coldest night of the year. Not the USDA map, and CropCard never uses it to limit what you plant";

export const ZONE_ESTIMATE_WIDE_LONG =
  "No NOAA station with 20 or more recorded winters is within 50 miles, so this uses the nearest one within 100 miles that sits within 1,000 ft of your farm's elevation (USGS). Rougher than a nearby station. Not the USDA map, and CropCard never uses it to limit what you plant";

export function zoneEstimateLong(zone: FarmZone): string | undefined {
  if (zone.provenance !== 'data') return undefined;
  return isWide(zone) ? ZONE_ESTIMATE_WIDE_LONG : ZONE_ESTIMATE_LONG;
}
