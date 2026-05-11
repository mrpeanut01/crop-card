/**
 * Solar position + shadow projection (NOAA-simplified).
 *
 * Pure math, no DB or env deps. Inputs: lat/lon, calendar date, local hour
 * (0-24, decimal). Output: sun azimuth/elevation in degrees and a derived
 * shadow vector (direction + length per unit canopy height).
 *
 * Accuracy is "directionally correct, ±1° elevation, ±2° azimuth" — enough
 * to decide which neighbor blocks fall under shadow. Not suitable for
 * agronomic-grade insolation modeling. The shade UI is a planning hint, not
 * a yield model.
 *
 * Formulas adapted from the NOAA Solar Position Algorithm public material
 * (https://gml.noaa.gov/grad/solcalc/), simplified for ±1° accuracy.
 */

export interface SolarPosition {
  /** Sun bearing measured clockwise from due north. 0=N, 90=E, 180=S, 270=W. */
  azimuthDeg: number;
  /** Angle above horizon. 0=horizon, 90=overhead. Negative when below horizon. */
  elevationDeg: number;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Solar declination in degrees for a given day-of-year (1..366).
 * Approximation: ±0.4° accuracy, sufficient for shade-model purposes.
 */
export function solarDeclinationDeg(dayOfYear: number): number {
  return 23.45 * Math.sin(((360 / 365) * (dayOfYear - 81)) * DEG_TO_RAD);
}

/**
 * Equation of time in minutes for a given day-of-year. Corrects for the
 * Earth's elliptical orbit + axial tilt; small but non-zero (±16 min).
 */
export function equationOfTimeMinutes(dayOfYear: number): number {
  const b = ((360 / 365) * (dayOfYear - 81)) * DEG_TO_RAD;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/**
 * Local solar time (decimal hours) at the given lon for a clock hour. We
 * use the standard meridian convention: lon east is positive, west negative.
 * `clockHourLocal` is clock-time on the user's local zone in decimal hours.
 * For the v1 shade model we treat the standard meridian as 15° × round(lon/15),
 * which matches the typical-meridian assumption baked into a clock without
 * needing a tz database.
 */
export function localSolarHour(
  lon: number,
  clockHourLocal: number,
  dayOfYear: number
): number {
  const standardMeridian = Math.round(lon / 15) * 15;
  const eotMin = equationOfTimeMinutes(dayOfYear);
  const correctionMin = 4 * (lon - standardMeridian) + eotMin;
  return clockHourLocal + correctionMin / 60;
}

/**
 * Sun position at the given location/date/clock-hour. `clockHourLocal` is
 * clock time in the farm's local zone (decimal hours, 0-24).
 */
export function solarPosition(
  lat: number,
  lon: number,
  dateMs: number,
  clockHourLocal: number
): SolarPosition {
  const day = dayOfYear(dateMs);
  const decl = solarDeclinationDeg(day) * DEG_TO_RAD;
  const lst = localSolarHour(lon, clockHourLocal, day);
  const hourAngleDeg = 15 * (lst - 12);
  const ha = hourAngleDeg * DEG_TO_RAD;
  const phi = lat * DEG_TO_RAD;

  const sinElev = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const elev = Math.asin(Math.max(-1, Math.min(1, sinElev)));

  // Azimuth in north-clockwise convention via atan2 — handles all quadrants
  // and the noon degenerate case. Numerators of sin(A) and cos(A) have
  // different cosine-product denominators; we factor cos(α) out of both
  // and rescale sin(A) by cos(φ) so atan2 sees consistent ratios.
  const sinAzScaled = -Math.sin(ha) * Math.cos(decl) * Math.cos(phi);
  const cosAzScaled = Math.sin(decl) - Math.sin(elev) * Math.sin(phi);
  const azRad = Math.atan2(sinAzScaled, cosAzScaled);
  const azDeg = ((azRad * RAD_TO_DEG) % 360 + 360) % 360;
  return {
    azimuthDeg: azDeg,
    elevationDeg: elev * RAD_TO_DEG
  };
}

/** Shadow falls in the opposite direction of the sun. */
export function shadowDirectionDeg(sunAzimuthDeg: number): number {
  return (sunAzimuthDeg + 180) % 360;
}

/**
 * Length of the shadow cast by a vertical object of given height, given the
 * sun's elevation. Returns +Infinity for sun at or below the horizon.
 * Caller should clamp.
 */
export function shadowLengthMeters(heightMeters: number, sunElevationDeg: number): number {
  if (sunElevationDeg <= 0.5) return Infinity;
  return heightMeters / Math.tan(sunElevationDeg * DEG_TO_RAD);
}

/**
 * Convert (azimuth, length-in-meters) into a (Δlon, Δlat) offset suitable
 * for adding to a [lon, lat] point. Uses the local equirectangular
 * approximation. Accurate to a few percent at small (sub-km) distances —
 * fine for farm-block scales.
 */
export function offsetLonLatByMeters(
  fromLat: number,
  azimuthDeg: number,
  meters: number
): { dLon: number; dLat: number } {
  const azRad = azimuthDeg * DEG_TO_RAD;
  const dNorth = Math.cos(azRad) * meters;
  const dEast = Math.sin(azRad) * meters;
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos(fromLat * DEG_TO_RAD);
  return {
    dLat: dNorth / metersPerDegLat,
    dLon: dEast / (metersPerDegLon || 1e-9)
  };
}

export function dayOfYear(dateMs: number): number {
  const d = new Date(dateMs);
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

export function feetToMeters(ft: number): number {
  return ft * 0.3048;
}

export function metersToFeet(m: number): number {
  return m / 0.3048;
}
