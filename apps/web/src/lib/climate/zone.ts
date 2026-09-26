import {
  FROST_LOOKUP_MAX_MI,
  frostStationFromRow,
  frostStationLabel,
  loadFrostDataset,
  nearestFrostStation,
  stationExtremeMinF,
  type FrostDataset,
  type FrostStation
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

export interface ZoneLookup {
  provenance: 'data';
  zone: HardinessZone;
  extremeMinF: number;
  station: FrostStation;
}

/** Nearest station with an extreme minimum within the frost lookup's 50-mile
 *  cap. No station in range, no location or no dataset gives null: there is
 *  no fallback zone. */
export function lookupZoneInDataset(
  dataset: FrostDataset | null,
  lat: number | null | undefined,
  lon: number | null | undefined,
  opts: { maxDistanceMi?: number } = {}
): ZoneLookup | null {
  if (!dataset || typeof lat !== 'number' || typeof lon !== 'number') return null;
  const hit = nearestFrostStation(dataset, lat, lon, {
    maxDistanceMi: opts.maxDistanceMi ?? FROST_LOOKUP_MAX_MI,
    accept: (row) => stationExtremeMinF(row) !== null
  });
  if (!hit) return null;
  const extremeMinF = stationExtremeMinF(hit.row);
  const zone = zoneFromExtremeMin(extremeMinF);
  if (extremeMinF === null || !zone) return null;
  return {
    provenance: 'data',
    zone,
    extremeMinF,
    station: frostStationFromRow(hit.row, hit.distanceMi)
  };
}

export async function lookupZone(
  lat: number | null | undefined,
  lon: number | null | undefined
): Promise<ZoneLookup | null> {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return lookupZoneInDataset(await loadFrostDataset(), lat, lon);
}

/** A farm's zone as screens and Cards show it. */
export interface FarmZone {
  zone: string;
  provenance: 'data' | 'manual';
  stationName: string | null;
  distanceMi: number | null;
  extremeMinF: number | null;
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
    extremeMinF: lookup.extremeMinF
  };
}

/** "Zone 7a (approx.)" for an estimate, "Zone 7a" for the owner's own. */
export function zoneValueLabel(zone: Pick<FarmZone, 'zone' | 'provenance'>): string {
  return zone.provenance === 'data' ? `Zone ${zone.zone} (approx.)` : `Zone ${zone.zone}`;
}

/** Provenance detail: "from Washington DC Dulles AP, VA · 6 mi". */
export function zoneSourceDetail(zone: FarmZone): string | undefined {
  if (zone.provenance === 'manual') return 'your zone';
  if (!zone.stationName) return undefined;
  if (zone.distanceMi === null) return `from ${zone.stationName}`;
  return `from ${frostStationLabel({ id: '', name: zone.stationName, distanceMi: zone.distanceMi, elevM: null })}`;
}

export const ZONE_ESTIMATE_LONG =
  "Estimated from the nearest NOAA station's 1991-2020 average coldest night of the year. Not the USDA map, and CropCard never uses it to limit what you plant";
