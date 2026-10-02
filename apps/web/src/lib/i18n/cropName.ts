import { CROP_ID_BY_NAME, CROP_NAMES_ES } from './cropNames.es';

const ENGLISH_BY_ID: Record<string, string> = Object.fromEntries(
  Object.entries(CROP_ID_BY_NAME).map(([name, id]) => [id, name])
);

function isSpanish(locale: string | null | undefined): boolean {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('es');
}

/**
 * Display-only crop name. A planting's stored name can be typed by the owner,
 * so the Spanish name replaces it only when it is still the plugin's own
 * English name (or empty); anything else is user data and is shown as stored.
 */
export function cropDisplayName(
  pluginId: string | null | undefined,
  englishName: string,
  locale: string | null | undefined
): string {
  if (!isSpanish(locale) || !pluginId) return englishName;
  const es = CROP_NAMES_ES[pluginId];
  if (!es) return englishName;
  const canonical = ENGLISH_BY_ID[pluginId];
  const shown = (englishName ?? '').trim();
  if (shown === '' || shown === canonical) return es;
  return englishName;
}

export function cropDisplayNameByEnglish(
  englishName: string,
  locale: string | null | undefined
): string {
  if (!isSpanish(locale)) return englishName;
  const id = CROP_ID_BY_NAME[(englishName ?? '').trim()];
  return id ? (CROP_NAMES_ES[id] ?? englishName) : englishName;
}
