/**
 * C-35 §3, defence in depth: a farm's own copy of a shared plugin can only
 * keep or lengthen a hold. The hold ledger already takes the longer of the
 * data a record was saved with and the data on file now, so a shorter copy
 * cannot shorten an existing hold; this check refuses the copy at
 * registration so it cannot shorten a future one either.
 */

/** Intervals where a smaller number is a shorter hold. */
const INTERVAL_KEYS = new Set([
  'grazeDays',
  'hayDays',
  'lactatingDairyGrazeDays',
  'meatAnimalRemovalBeforeSlaughterDays',
  'preHarvestIntervalDays',
  'reEntryIntervalHours',
  'meatDays',
  'milkHours',
  'eggsDays'
]);

/** Intervals where a missing value means "none" rather than "unknown". */
const MISSING_IS_ZERO = new Set(['preHarvestIntervalDays', 'reEntryIntervalHours']);

/** Flags that, once set, only make a hold stricter. */
const STRICT_FLAGS = new Set(['notForPasture', 'prohibited', 'notForSlaughter']);

/** Label classes from narrowest to widest on-label use (C-11). */
const CLASS_WIDTH: Record<string, number> = {
  'non-lactating': 0,
  'lactating-dairy': 0,
  'non-laying': 0,
  laying: 0,
  all: 1
};

/** Keys that identify one element of an array across the two copies. */
const IDENTITY_KEYS = ['speciesId', 'cropPluginId', 'cropId', 'crop', 'class', 'lactating'];

export interface HoldFieldChange {
  field: string;
  shared: string;
  farm: string;
}

type Json = unknown;

function isObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function identity(v: Json): string | null {
  if (!isObject(v)) return null;
  const parts = IDENTITY_KEYS.filter((k) => k in v).map((k) => `${k}=${String(v[k])}`);
  return parts.length ? parts.join('&') : null;
}

function show(v: Json): string {
  return v === undefined ? 'none' : typeof v === 'string' ? v : JSON.stringify(v);
}

function walk(shared: Json, farm: Json, path: string, out: HoldFieldChange[]): void {
  if (Array.isArray(shared)) {
    const farmList = Array.isArray(farm) ? farm : [];
    shared.forEach((item, i) => {
      const id = identity(item);
      const match = id === null ? farmList[i] : farmList.find((f) => identity(f) === id);
      if (match === undefined && isObject(item)) {
        for (const [k, v] of Object.entries(item)) {
          if (INTERVAL_KEYS.has(k) && typeof v === 'number' && v > 0 && MISSING_IS_ZERO.has(k)) {
            out.push({ field: `${path}[${id ?? i}].${k}`, shared: show(v), farm: 'none' });
          }
          if (STRICT_FLAGS.has(k) && v === true) {
            out.push({ field: `${path}[${id ?? i}].${k}`, shared: 'true', farm: 'none' });
          }
        }
        return;
      }
      walk(item, match, `${path}[${id ?? i}]`, out);
    });
    return;
  }
  if (!isObject(shared)) return;
  const f = isObject(farm) ? farm : {};
  for (const [key, value] of Object.entries(shared)) {
    const at = path ? `${path}.${key}` : key;
    const other = f[key];
    if (INTERVAL_KEYS.has(key) && typeof value === 'number') {
      if (typeof other === 'number' && other < value) {
        out.push({ field: at, shared: show(value), farm: show(other) });
      } else if (other === undefined && MISSING_IS_ZERO.has(key) && value > 0) {
        out.push({ field: at, shared: show(value), farm: 'none' });
      }
      continue;
    }
    if (STRICT_FLAGS.has(key) && value === true && other !== true) {
      out.push({ field: at, shared: 'true', farm: show(other) });
      continue;
    }
    if (key === 'class' && typeof value === 'string' && typeof other === 'string') {
      if ((CLASS_WIDTH[other] ?? 1) > (CLASS_WIDTH[value] ?? 1)) {
        out.push({ field: at, shared: value, farm: other });
      }
      continue;
    }
    if (key === 'doNotUseFor' && Array.isArray(value)) {
      const kept = Array.isArray(other) ? other : [];
      for (const food of value) {
        if (!kept.includes(food)) out.push({ field: at, shared: show(value), farm: show(other) });
      }
      continue;
    }
    if (typeof value === 'object' && value !== null) walk(value, other, at, out);
  }
}

/** Every hold field the farm copy would shorten, in reading order. */
export function pluginShortensHold(shared: Json, farm: Json): HoldFieldChange[] {
  const out: HoldFieldChange[] = [];
  walk(shared, farm, '', out);
  return out;
}

export function pluginShortensHoldMessage(change: HoldFieldChange): string {
  return `This farm copy would shorten a hold (${change.field}: ${change.shared} → ${change.farm}). Farm copies can only keep or lengthen holds.`;
}
