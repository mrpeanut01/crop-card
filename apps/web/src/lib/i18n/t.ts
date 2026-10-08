import { en, type MessageKey } from './catalogs/en';
import { es } from './catalogs/es';
import { isEnglishOnly } from './englishOnly';
import { DEFAULT_LOCALE, isKnownLocale, type Locale } from './locales';

export type { MessageKey };

/** A plural message's base key: `nav.pendingRecords` for the pair
 *  `nav.pendingRecords.one` / `nav.pendingRecords.other`. */
export type PluralKey = MessageKey extends infer K
  ? K extends `${infer B}.other`
    ? B
    : never
  : never;

export type TranslateKey = MessageKey | PluralKey;
export type MessageParams = Record<string, string | number>;

const CATALOGS: Record<Locale, Partial<Record<MessageKey, string>>> = { en, es };

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralCategory(locale: Locale, count: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

function lookup(locale: Locale, key: string): string | undefined {
  const table = locale === DEFAULT_LOCALE || isEnglishOnly(key) ? en : CATALOGS[locale];
  const hit = (table as Record<string, string | undefined>)[key];
  if (hit !== undefined) return hit;
  return (en as Record<string, string | undefined>)[key];
}

function interpolate(template: string, params: MessageParams | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}(\.(?!\.))?/g, (whole, name: string, dot?: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return whole;
    const value = String(params[name]);
    return dot && !value.endsWith('.') ? value + dot : value;
  });
}

/** Translate `key` for `locale`. An unknown locale reads as English, a
 *  missing translation falls back to English, and an English-only key is
 *  always English. A plural base picks `.one`/`.other` from `count`. */
export function t(
  locale: string | null | undefined,
  key: TranslateKey,
  params?: MessageParams
): string {
  const loc: Locale = isKnownLocale(locale) ? locale : DEFAULT_LOCALE;
  let template = lookup(loc, key);
  if (template === undefined) {
    const count = typeof params?.count === 'number' ? params.count : Number.NaN;
    const category = Number.isFinite(count) ? pluralCategory(loc, count) : 'other';
    const pluralLocale = isEnglishOnly(key) ? DEFAULT_LOCALE : loc;
    template =
      lookup(pluralLocale, `${key}.${category}`) ?? lookup(pluralLocale, `${key}.other`) ?? key;
  }
  return interpolate(template, params);
}

export type Translator = (key: TranslateKey, params?: MessageParams) => string;

export function createT(locale: string | null | undefined): Translator {
  return (key, params) => t(locale, key, params);
}
