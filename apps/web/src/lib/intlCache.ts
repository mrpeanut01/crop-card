/**
 * Cached `Intl` formatters.
 *
 * `Date#toLocaleString` and `Number#toLocaleString` build a fresh formatter
 * (locale negotiation, time-zone data lookup) on every call, which showed
 * up as a third of /records CPU in a load test. These helpers return the
 * same output from a formatter built once per (locale, options) pair.
 */

const MAX_ENTRIES = 256;

function bounded<V>(): {
  get: (key: string, make: () => V) => V;
  clear: () => void;
  size: () => number;
} {
  const map = new Map<string, V>();
  return {
    get(key, make) {
      let v = map.get(key);
      if (v === undefined) {
        v = make();
        if (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value as string);
        map.set(key, v);
      }
      return v;
    },
    clear: () => map.clear(),
    size: () => map.size
  };
}

const dateFormats = bounded<Intl.DateTimeFormat>();
const numberFormats = bounded<Intl.NumberFormat>();

type DateRequired = 'any' | 'date' | 'time';

const DATE_FIELDS = ['weekday', 'year', 'month', 'day'] as const;
const TIME_FIELDS = ['dayPeriod', 'hour', 'minute', 'second', 'fractionalSecondDigits'] as const;

/** ECMA-402 ToDateTimeOptions: the date/time fields `toLocaleString`
 *  (required 'any', defaults 'all'), `toLocaleDateString` ('date', 'date')
 *  and `toLocaleTimeString` ('time', 'time') add when the caller gave none.
 *  The `Intl.DateTimeFormat` constructor only defaults to the date fields,
 *  so the options have to be completed first to match those methods. */
function withDefaults(
  options: Intl.DateTimeFormatOptions,
  required: DateRequired
): Intl.DateTimeFormatOptions {
  const o = options as Record<string, unknown>;
  if (o.dateStyle !== undefined || o.timeStyle !== undefined) return options;
  const hasDate = required !== 'time' && DATE_FIELDS.some((k) => o[k] !== undefined);
  const hasTime = required !== 'date' && TIME_FIELDS.some((k) => o[k] !== undefined);
  if (hasDate || hasTime) return options;
  const out: Intl.DateTimeFormatOptions = { ...options };
  if (required !== 'time') {
    out.year = 'numeric';
    out.month = 'numeric';
    out.day = 'numeric';
  }
  if (required !== 'date') {
    out.hour = 'numeric';
    out.minute = 'numeric';
    out.second = 'numeric';
  }
  return out;
}

export function dateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions = {}
): Intl.DateTimeFormat {
  return dateFormats.get(
    `${locale}|${JSON.stringify(options)}`,
    () => new Intl.DateTimeFormat(locale, options)
  );
}

export function numberFormat(
  locale: string,
  options: Intl.NumberFormatOptions = {}
): Intl.NumberFormat {
  return numberFormats.get(
    `${locale}|${JSON.stringify(options)}`,
    () => new Intl.NumberFormat(locale, options)
  );
}

/** Same output as `date.toLocaleString(locale, options)`. */
export function dateToLocaleString(
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (Number.isNaN(date.getTime())) return 'Invalid Date';
  return dateTimeFormat(locale, withDefaults(options, 'any')).format(date);
}

/** Same output as `date.toLocaleDateString(locale, options)`. */
export function dateToLocaleDateString(
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (Number.isNaN(date.getTime())) return 'Invalid Date';
  return dateTimeFormat(locale, withDefaults(options, 'date')).format(date);
}

/** Same output as `date.toLocaleTimeString(locale, options)`. */
export function dateToLocaleTimeString(
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (Number.isNaN(date.getTime())) return 'Invalid Date';
  return dateTimeFormat(locale, withDefaults(options, 'time')).format(date);
}

/** Same output as `n.toLocaleString(locale, options)`. */
export function numberToLocaleString(
  n: number,
  locale: string,
  options: Intl.NumberFormatOptions = {}
): string {
  return numberFormat(locale, options).format(n);
}

export const __intlCacheForTests = {
  clear: () => {
    dateFormats.clear();
    numberFormats.clear();
  },
  sizes: () => ({ date: dateFormats.size(), number: numberFormats.size() }),
  maxEntries: MAX_ENTRIES
};
