import { t, type TranslateKey } from '$lib/i18n';
import { dateToLocaleDateString } from '$lib/intlCache';
import { intlLocale } from '$lib/prefs';
import {
  EARLIEST_OFFSET_DAYS,
  defaultDtmFor,
  earliestOffsetDays,
  hardinessFrom,
  type Hardiness
} from '$lib/schedule/scheduleCandidacy';

export interface PlantingWindowCrop {
  cropFamily?: string | null;
  soilTempMinF?: number | null;
  dtmMaxDays?: number | null;
}

/** Frost dates as local calendar days (yyyy-mm-dd). Day strings, not epoch
 *  ms, so the server and the browser agree regardless of time zone. */
export interface FrostDatesIso {
  lastSpring: string;
  firstFall: string;
}

export interface PlantingWindow {
  earliest: string;
  prime: string;
  latest: string;
  note: string | null;
}

export type DateFit = 'early' | 'late' | 'ok';

const PRIME_OFFSET_DAYS: Record<Hardiness, number> = {
  hardy: -28,
  'half-hardy': 0,
  tender: 14
};

const MATURITY_BUFFER_DAYS = 14;
const ONE_DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const HARDINESS_NOTE_KEY: Record<Hardiness, TranslateKey> = {
  hardy: 'plantui.window.hardy',
  'half-hardy': 'plantui.window.halfHardy',
  tender: 'plantui.window.tender'
};

function parseDay(iso: string): number | null {
  if (!ISO_DAY.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  return toDay(parseDay(iso)! + days * ONE_DAY_MS);
}

export function formatDay(iso: string, locale?: string | null): string {
  const ms = parseDay(iso);
  if (ms === null) return iso;
  return dateToLocaleDateString(new Date(ms), intlLocale(locale), {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

/** Frost-date window from plugin data. Always succeeds; this is the no-key
 *  path and the baseline the AI refinement is checked against. */
export function deterministicPlantingWindow(
  crop: PlantingWindowCrop,
  frost: FrostDatesIso & { frostFree?: boolean },
  locale?: string | null
): PlantingWindow {
  const hardiness = hardinessFrom(crop.soilTempMinF, crop.cropFamily);
  const dtm = crop.dtmMaxDays ?? defaultDtmFor(hardiness);
  if (frost.frostFree) return frostFreeWindow(frost, dtm, locale);
  const earliest = addDays(
    frost.lastSpring,
    earliestOffsetDays(crop.soilTempMinF, crop.cropFamily)
  );
  const naturalLatest = addDays(frost.firstFall, -(dtm + MATURITY_BUFFER_DAYS));

  if (naturalLatest < earliest) {
    return {
      earliest,
      prime: earliest,
      latest: earliest,
      note: t(locale, 'plantui.window.tight', {
        days: dtm,
        date: formatDay(frost.firstFall, locale)
      })
    };
  }

  let prime = addDays(frost.lastSpring, PRIME_OFFSET_DAYS[hardiness]);
  if (prime < earliest) prime = earliest;
  if (prime > naturalLatest) prime = naturalLatest;
  return { earliest, prime, latest: naturalLatest, note: t(locale, HARDINESS_NOTE_KEY[hardiness]) };
}

export const FROST_FREE_NOTE = 'No frost limit for this bed.';

/** Frost-free bed (E2-6): Jan 1 to Dec 31 minus DTM and the buffer, no
 *  hardiness offsets. The Jan 1 floor at tomorrow is applied by callers
 *  that know "now" (scheduleCandidacy). */
function frostFreeWindow(
  frost: FrostDatesIso,
  dtm: number,
  locale?: string | null
): PlantingWindow {
  const earliest = frost.lastSpring;
  const naturalLatest = addDays(frost.firstFall, -(dtm + MATURITY_BUFFER_DAYS));
  const latest = naturalLatest < earliest ? earliest : naturalLatest;
  return {
    earliest,
    prime: earliest,
    latest,
    note: locale ? t(locale, 'plantui.window.frostFree') : FROST_FREE_NOTE
  };
}

/** True when the three dates parse, are ordered, and sit in `year`. With
 *  `frost`, a season that crosses the new year also allows dates from the
 *  earliest planting before its spring frost to its fall frost. */
export function isValidWindow(
  w: unknown,
  year: number,
  frost?: FrostDatesIso
): w is PlantingWindow {
  if (!w || typeof w !== 'object') return false;
  const { earliest, prime, latest, note } = w as Record<string, unknown>;
  if (typeof earliest !== 'string' || typeof prime !== 'string' || typeof latest !== 'string') {
    return false;
  }
  if (note !== null && note !== undefined && typeof note !== 'string') return false;
  if (parseDay(earliest) === null || parseDay(prime) === null || parseDay(latest) === null) {
    return false;
  }
  if (!(earliest <= prime && prime <= latest)) return false;
  let lo = `${year}-01-01`;
  let hi = `${year}-12-31`;
  if (frost && parseDay(frost.lastSpring) !== null && parseDay(frost.firstFall) !== null) {
    const springFloor = addDays(frost.lastSpring, EARLIEST_OFFSET_DAYS.hardy);
    if (springFloor < lo) lo = springFloor;
    if (frost.firstFall > hi) hi = frost.firstFall;
  }
  return earliest >= lo && latest <= hi;
}

export function dateFit(dateIso: string, w: PlantingWindow): DateFit | null {
  if (parseDay(dateIso) === null) return null;
  if (dateIso < w.earliest) return 'early';
  if (dateIso > w.latest) return 'late';
  return 'ok';
}
