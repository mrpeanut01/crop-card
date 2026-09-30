import { isEnglishOnly } from './englishOnly';

export interface CatalogProblem {
  key: string;
  kind: 'missing' | 'english-only-translated' | 'placeholders' | 'unknown-key';
  detail: string;
}

export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

/** F5-7: every English key is either translated or English-only, no
 *  English-only key is translated, placeholders match, and the translation
 *  names no key English lacks. */
export function checkCatalog(
  en: Record<string, string>,
  other: Record<string, string | undefined>,
  englishOnly: (key: string) => boolean = isEnglishOnly
): CatalogProblem[] {
  const problems: CatalogProblem[] = [];
  for (const [key, text] of Object.entries(en)) {
    const value = other[key];
    if (englishOnly(key)) {
      if (value !== undefined) {
        problems.push({
          key,
          kind: 'english-only-translated',
          detail: 'This message must stay English until the human review.'
        });
      }
      continue;
    }
    if (value === undefined) {
      problems.push({ key, kind: 'missing', detail: 'No translation and not English-only.' });
      continue;
    }
    const want = placeholders(text).join(',');
    const got = placeholders(value).join(',');
    if (want !== got) {
      problems.push({
        key,
        kind: 'placeholders',
        detail: `English has {${want}} but the translation has {${got}}.`
      });
    }
  }
  for (const key of Object.keys(other)) {
    if (!(key in en)) {
      problems.push({ key, kind: 'unknown-key', detail: 'English has no such key.' });
    }
  }
  return problems;
}
