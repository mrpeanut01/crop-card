/**
 * The demo farm's content in the visitor's language. The catalog and the
 * timeline stay English; the seed passes each name, note and title it
 * writes through this, so a visitor who starts the demo in Spanish gets a
 * Spanish farm. With no locale (or English) every string comes back as is.
 */

import { t, type MessageKey } from '$lib/i18n';
import { enEntry } from '$lib/i18n/catalogs/en/entry';

const STATIC_PREFIX = 'entry.demoFarm.s.';
const PATTERN_PREFIX = 'entry.demoFarm.p.';

interface Pattern {
  key: MessageKey;
  re: RegExp;
  names: string[];
}

let staticKeys: Map<string, MessageKey> | null = null;
let patterns: Pattern[] | null = null;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function load(): { staticKeys: Map<string, MessageKey>; patterns: Pattern[] } {
  if (!staticKeys || !patterns) {
    staticKeys = new Map();
    patterns = [];
    for (const [key, english] of Object.entries(enEntry) as Array<[MessageKey, string]>) {
      if (key.startsWith(STATIC_PREFIX)) {
        staticKeys.set(english, key);
      } else if (key.startsWith(PATTERN_PREFIX)) {
        const names: string[] = [];
        const source = english
          .split(/(\{[a-zA-Z]+\})/)
          .map((part) => {
            const m = /^\{([a-zA-Z]+)\}$/.exec(part);
            if (!m) return escapeRe(part);
            names.push(m[1]);
            return '(.+?)';
          })
          .join('');
        patterns.push({ key, re: new RegExp(`^${source}$`), names });
      }
    }
  }
  return { staticKeys, patterns };
}

function translate(text: string, locale: string, depth: number): string {
  const { staticKeys: keys, patterns: list } = load();
  const exact = keys.get(text);
  if (exact) return t(locale, exact);
  if (depth > 1) return text;
  for (const p of list) {
    const m = p.re.exec(text);
    if (!m) continue;
    const params: Record<string, string> = {};
    p.names.forEach((name, i) => {
      params[name] = translate(m[i + 1], locale, depth + 1);
    });
    return t(locale, p.key, params);
  }
  return text;
}

export type DemoLocalizer = <T extends string | null | undefined>(text: T) => T;

export function demoLocalizer(locale?: string | null): DemoLocalizer {
  if (!locale || locale === 'en') return (text) => text;
  return (<T extends string | null | undefined>(text: T): T =>
    (typeof text === 'string' ? translate(text, locale, 0) : text) as T) as DemoLocalizer;
}
