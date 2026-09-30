/** Every locale the code knows. Only the ones listed in `CROPCARD_LOCALES`
 *  resolve at run time (F5-1); the default list is English alone. */
export const KNOWN_LOCALES = ['en', 'es'] as const;
export type Locale = (typeof KNOWN_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Each language by its own name, as the picker shows it (F5-9). */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español'
};

export function isKnownLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (KNOWN_LOCALES as readonly string[]).includes(value);
}

/** Parse the flag. Unknown entries are dropped, English is always present
 *  and always first, and duplicates collapse. */
export function parseEnabledLocales(raw: string | undefined | null): readonly Locale[] {
  const out: Locale[] = [DEFAULT_LOCALE];
  for (const part of (raw ?? '').split(',')) {
    const code = part.trim().toLowerCase();
    if (isKnownLocale(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

let cachedRaw: string | undefined | null = null;
let cachedList: readonly Locale[] = [DEFAULT_LOCALE];

/** The enabled list, read from the environment on the server. In the
 *  browser there is no environment, so it is English alone; client code
 *  takes the resolved locale from page data instead. */
export function enabledLocales(): readonly Locale[] {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.CROPCARD_LOCALES;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parseEnabledLocales(raw);
  }
  return cachedList;
}

/** The enabled list at module load, for code that only needs a snapshot. */
export const ENABLED_LOCALES: readonly Locale[] = enabledLocales();
