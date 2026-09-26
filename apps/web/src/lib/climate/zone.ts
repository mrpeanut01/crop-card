/**
 * An approximate hardiness zone from a weather station's 1991-2020 mean
 * annual extreme minimum temperature. It follows the USDA zone bands (10 °F
 * zones split into 5 °F halves) but is not the USDA map, which is drawn from
 * a gridded climate model. Display only: nothing plans, filters or gates on it.
 */

import {
  FROST_LOOKUP_MAX_MI,
  nearestFrostStation,
  type FrostDataset,
  type FrostStationRow
} from './frostNormals';

export type ZoneHalf = 'a' | 'b';

export interface HardinessZoneBand {
  zone: number;
  half: ZoneHalf;
  /** "7a" */
  label: string;
  /** Band edges in °F, lower inclusive, upper exclusive. */
  minF: number;
  maxF: number;
}

export const MIN_ZONE = 1;
export const MAX_ZONE = 13;
const ZONE_1_FLOOR_F = -60;

export const HARDINESS_ZONES: readonly string[] = Array.from(
  { length: (MAX_ZONE - MIN_ZONE + 1) * 2 },
  (_, i) => `${MIN_ZONE + Math.floor(i / 2)}${i % 2 === 0 ? 'a' : 'b'}`
);

/**
 * Zone from a mean annual extreme minimum in °F. Zone 1a starts at -60 °F
 * and each half is 5 °F wide, so 0 °F is 7a and 5 °F is 7b. Colder than
 * -60 °F reads as 1a and 70 °F or warmer as 13b, the ends of the scale.
 */
export function zoneFromExtremeMin(extremeMinF: number): HardinessZoneBand | null {
  if (typeof extremeMinF !== 'number' || !Number.isFinite(extremeMinF)) return null;
  const maxIndex = (MAX_ZONE - MIN_ZONE + 1) * 2 - 1;
  let raw = Math.floor((extremeMinF - ZONE_1_FLOOR_F) / 5);
  if (extremeMinF < ZONE_1_FLOOR_F + raw * 5) raw -= 1;
  else if (extremeMinF >= ZONE_1_FLOOR_F + (raw + 1) * 5) raw += 1;
  const index = Math.min(maxIndex, Math.max(0, raw));
  const zone = MIN_ZONE + Math.floor(index / 2);
  const half: ZoneHalf = index % 2 === 0 ? 'a' : 'b';
  const minF = ZONE_1_FLOOR_F + index * 5;
  return { zone, half, label: `${zone}${half}`, minF, maxF: minF + 5 };
}

/** "7a", " 7A " → "7a"; anything that isn't a zone on the 1a-13b scale → null. */
export function parseHardinessZone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return HARDINESS_ZONES.includes(v) ? v : null;
}

const EXTREME_COL = 14;

export function stationExtremeMinF(row: FrostStationRow): number | null {
  const v = row[EXTREME_COL];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface ZoneLookup {
  band: HardinessZoneBand;
  extremeMinF: number;
  station: { id: string; name: string; distanceMi: number };
}

/** Nearest station with an extreme-minimum value within the frost lookup's
 *  50-mile cap, or null. */
export function lookupZoneInDataset(
  dataset: FrostDataset | null,
  lat: number | null | undefined,
  lon: number | null | undefined,
  maxDistanceMi = FROST_LOOKUP_MAX_MI
): ZoneLookup | null {
  if (!dataset || typeof lat !== 'number' || typeof lon !== 'number') return null;
  const hit = nearestFrostStation(dataset, lat, lon, {
    maxDistanceMi,
    filter: (row) => stationExtremeMinF(row) !== null
  });
  if (!hit) return null;
  const extremeMinF = stationExtremeMinF(hit.row)!;
  const band = zoneFromExtremeMin(extremeMinF);
  if (!band) return null;
  return {
    band,
    extremeMinF,
    station: {
      id: String(hit.row[0]),
      name: String(hit.row[1] ?? hit.row[0]),
      distanceMi: Math.round(hit.distanceMi * 10) / 10
    }
  };
}

export type ZoneProvenance = 'data' | 'manual';

/** What the chip shows: the owner's own zone, else the station estimate. */
export interface HardinessZoneView {
  label: string;
  provenance: ZoneProvenance;
  stationName: string | null;
  distanceMi: number | null;
  extremeMinF: number | null;
  /** The station estimate, kept next to an owner override. */
  estimate: string | null;
}

export function resolveHardinessZone(
  stored: { zone: string | null | undefined; provenance: string | null | undefined },
  lookup: ZoneLookup | null
): HardinessZoneView | null {
  const manual = stored.provenance === 'manual' ? parseHardinessZone(stored.zone) : null;
  if (manual) {
    return {
      label: manual,
      provenance: 'manual',
      stationName: null,
      distanceMi: null,
      extremeMinF: null,
      estimate: lookup?.band.label ?? null
    };
  }
  if (!lookup) return null;
  return {
    label: lookup.band.label,
    provenance: 'data',
    stationName: lookup.station.name,
    distanceMi: lookup.station.distanceMi,
    extremeMinF: lookup.extremeMinF,
    estimate: lookup.band.label
  };
}

/** "Zone 7a (approx., from Washington DC Dulles AP, VA)" or "Zone 7a (your setting)". */
export function hardinessZoneText(view: HardinessZoneView): string {
  if (view.provenance === 'manual') return `Zone ${view.label} (your setting)`;
  return view.stationName
    ? `Zone ${view.label} (approx., from ${view.stationName})`
    : `Zone ${view.label} (approx.)`;
}

/** Provenance detail for the chip, e.g. "NOAA station averages, 1991-2020 · 12 mi". */
export function hardinessZoneDetail(view: HardinessZoneView): string {
  if (view.provenance === 'manual') {
    return view.estimate && view.estimate !== view.label
      ? `You set this; the station estimate is ${view.estimate}`
      : 'You set this';
  }
  const parts = ['NOAA station averages, 1991-2020'];
  if (view.distanceMi !== null) {
    parts.push(view.distanceMi < 1 ? '<1 mi' : `${Math.round(view.distanceMi)} mi`);
  }
  if (view.extremeMinF !== null) {
    parts.push(`average coldest night ${Math.round(view.extremeMinF)} °F`);
  }
  return parts.join(' · ');
}
