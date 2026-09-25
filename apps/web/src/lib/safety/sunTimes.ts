/**
 * #130 — sunrise / sunset for the pollinator gate's dusk-to-dawn window.
 *
 * NOAA Solar Calculator equations (https://gml.noaa.gov/grad/solcalc/),
 * evaluated at local solar noon; ±1–2 min at mid-latitudes. Pure — no DB,
 * env, or timezone database: the "day" is the local *solar* day at the
 * given longitude, so results are UTC epoch ms and DST-agnostic.
 */

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const RAD = Math.PI / 180;

/** Zenith for official sunrise/sunset: 90° + refraction + solar radius. */
const ZENITH_DEG = 90.833;

function solarDayIndex(t: number, lon: number): number {
  return Math.floor((t + lon * 4 * MIN_MS) / DAY_MS);
}

interface SolarTerms {
  declinationRad: number;
  eqTimeMin: number;
}

function solarTerms(jd: number): SolarTerms {
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const appLong = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliq = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);
  const declinationRad = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD));
  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTimeRad =
    y * Math.sin(2 * L0 * RAD) -
    2 * e * Math.sin(M * RAD) +
    4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
    0.5 * y * y * Math.sin(4 * L0 * RAD) -
    1.25 * e * e * Math.sin(2 * M * RAD);
  return { declinationRad, eqTimeMin: 4 * (eqTimeRad / RAD) };
}

/**
 * Sunrise + sunset for the local solar day containing `at` at (lat, lon).
 * Returns null during polar day / polar night or for invalid coordinates.
 */
export function sunTimesFor(lat: number, lon: number, at: Date): SunTimes | null {
  const t = at.getTime();
  if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const dayStartUtc = solarDayIndex(t, lon) * DAY_MS;
  const approxNoonMin = 720 - 4 * lon;
  const jd = (dayStartUtc + approxNoonMin * MIN_MS) / DAY_MS + 2440587.5;
  const { declinationRad, eqTimeMin } = solarTerms(jd);

  const latRad = lat * RAD;
  const cosHa =
    Math.cos(ZENITH_DEG * RAD) / (Math.cos(latRad) * Math.cos(declinationRad)) -
    Math.tan(latRad) * Math.tan(declinationRad);
  if (!(cosHa >= -1 && cosHa <= 1)) return null;
  const haDeg = Math.acos(cosHa) / RAD;

  const noonMin = 720 - 4 * lon - eqTimeMin;
  return {
    sunrise: new Date(dayStartUtc + (noonMin - 4 * haDeg) * MIN_MS),
    sunset: new Date(dayStartUtc + (noonMin + 4 * haDeg) * MIN_MS)
  };
}

/** First sunrise strictly after `at` (today's if before dawn, else tomorrow's). */
export function nextSunrise(lat: number, lon: number, at: Date): Date | null {
  const today = sunTimesFor(lat, lon, at);
  if (!today) return null;
  if (today.sunrise.getTime() > at.getTime()) return today.sunrise;
  return sunTimesFor(lat, lon, new Date(at.getTime() + DAY_MS))?.sunrise ?? null;
}
