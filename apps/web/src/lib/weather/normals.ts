/**
 * NOAA Climate Normals (1991–2020) — bundled subset.
 *
 * Hand-curated mean 4-inch soil temperature climatology for Loudoun County,
 * VA (USDA hardiness 7a, ~39.09°N), the only farm v1 supports out of the box.
 * Source: NCEI normals dataset, station-rolled monthly means.
 *
 * Adding more regions later is straightforward — keyed by zip prefix or
 * lat/lon-rounded key.
 *
 * For the swim-lane snap-on-drop: given a crop plugin's
 * `plantingGuide.soilTempMinF`, return the earliest day-of-year the
 * climatological soil temp meets it. The 7-day NWS forecast is used only
 * for near-term confirmation, not the snap target itself.
 */

export interface SoilTempProfile {
  /** Mean 4-inch soil temp (°F) by month (Jan=0..Dec=11). */
  monthlyMeanF: ReadonlyArray<number>;
  /** Region label for UI display. */
  label: string;
}

/** Loudoun County, VA (USDA 7a). Jan→Dec, mean 4-inch soil temp °F. */
export const LOUDOUN_VA: SoilTempProfile = {
  label: 'Loudoun County, VA (USDA 7a)',
  monthlyMeanF: [36, 38, 44, 53, 64, 73, 78, 76, 70, 60, 49, 40]
};

const PROFILES: Record<string, SoilTempProfile> = {
  default: LOUDOUN_VA,
  loudoun: LOUDOUN_VA
};

/** Pick a profile by region key; falls back to Loudoun. */
export function profileForRegion(regionKey: string | undefined): SoilTempProfile {
  if (!regionKey) return LOUDOUN_VA;
  return PROFILES[regionKey.toLowerCase()] ?? LOUDOUN_VA;
}

/** Linearly interpolate the soil-temp mean for a given day-of-year (1..366).
 *  Anchors at the 15th of each month. */
export function soilTempForDayOfYear(
  dayOfYear: number,
  profile: SoilTempProfile = LOUDOUN_VA
): number {
  // Map dayOfYear to a fractional month around the 15th.
  const monthStartDays = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
  const monthMidDays = monthStartDays.map((d) => d + 14);
  // Find left/right anchor months (wrap around year for late-Dec / early-Jan).
  let leftIdx = 0;
  for (let i = 0; i < 12; i++) {
    if (monthMidDays[i] <= dayOfYear) leftIdx = i;
  }
  if (dayOfYear < monthMidDays[0]) leftIdx = 11;
  const rightIdx = (leftIdx + 1) % 12;
  const leftDay = leftIdx === 11 && dayOfYear < monthMidDays[0] ? monthMidDays[11] - 365 : monthMidDays[leftIdx];
  const rightDay = rightIdx === 0 && leftIdx === 11 ? monthMidDays[0] : monthMidDays[rightIdx];
  const span = rightDay - leftDay;
  const t = span > 0 ? (dayOfYear - leftDay) / span : 0;
  const left = profile.monthlyMeanF[leftIdx];
  const right = profile.monthlyMeanF[rightIdx];
  return left + (right - left) * Math.max(0, Math.min(1, t));
}

function dayOfYearForMs(ms: number): number {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Earliest day in `year` where the climatological soil temp meets
 * `soilTempMinF`. Returns ms. If the threshold is met on Jan 1 already
 * (e.g. cold-tolerant cover), returns Jan 1 of `year`. If the threshold
 * is never met (over-spec'd plugin), returns null.
 */
export function soilTempEarliestDayMs(
  soilTempMinF: number,
  year: number,
  profile: SoilTempProfile = LOUDOUN_VA
): number | null {
  const yearStart = new Date(year, 0, 1).getTime();
  for (let doy = 1; doy <= 366; doy++) {
    if (soilTempForDayOfYear(doy, profile) >= soilTempMinF) {
      return yearStart + (doy - 1) * 86_400_000;
    }
  }
  return null;
}
