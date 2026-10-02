/**
 * Forage test units (Phase 33C, M-59). Units only: no computed risk class
 * ships, because the extension band tables disagree and differ on dry
 * matter basis. The lab's own rating is what the farmer sees.
 */

import { numberToLocaleString } from '$lib/intlCache';
import { NITRATE_UNIT_LABELS, type NitrateUnits } from './model';

/** `forage-toxicity-sources.json` entry the two factors come from. */
export const NITRATE_CONVERSION_ENTRY = 'nitrate.conversion.no3ToNo3N';
/** Nitrate (NO3) to nitrate-nitrogen (NO3-N): "multiply by 0.23" (Virginia Tech). */
export const NO3_TO_NO3N = 0.23;
/** Nitrate-nitrogen (NO3-N) to nitrate (NO3): "4.4" (Montana State, Table 2). */
export const NO3N_TO_NO3 = 4.4;
const PPM_PER_PCT = 10_000;

export interface ConvertedNitrate {
  ppmNitrate: number;
  ppmNitrateN: number;
}

/** Both ppm forms of a lab value, or null for `pct-kno3` (no sourced factor). */
export function convertNitrate(value: number, from: NitrateUnits): ConvertedNitrate | null {
  if (!Number.isFinite(value) || value < 0) return null;
  switch (from) {
    case 'ppm-nitrate':
      return { ppmNitrate: value, ppmNitrateN: value * NO3_TO_NO3N };
    case 'ppm-nitrate-n':
      return { ppmNitrate: value * NO3N_TO_NO3, ppmNitrateN: value };
    case 'pct-nitrate': {
      const ppm = value * PPM_PER_PCT;
      return { ppmNitrate: ppm, ppmNitrateN: ppm * NO3_TO_NO3N };
    }
    case 'pct-kno3':
      return null;
  }
}

function num(n: number): string {
  const digits = Math.abs(n) >= 100 ? 0 : 2;
  return numberToLocaleString(n, 'en-US', { maximumFractionDigits: digits });
}

/** The value exactly as the lab printed it, with its unit. */
export function nitrateAsTyped(value: number, units: NitrateUnits): string {
  return `${num(value)} ${NITRATE_UNIT_LABELS[units]}`;
}

/** The other forms, labelled as converted, or why there are none. */
export function nitrateConvertedText(value: number, units: NitrateUnits): string {
  const c = convertNitrate(value, units);
  if (!c) return 'Not converted: no conversion factor for potassium nitrate is on file.';
  const parts: string[] = [];
  if (units !== 'ppm-nitrate') parts.push(`${num(c.ppmNitrate)} ppm nitrate`);
  if (units !== 'ppm-nitrate-n') parts.push(`${num(c.ppmNitrateN)} ppm nitrate-nitrogen`);
  return `About ${parts.join(' or ')} (converted)`;
}
