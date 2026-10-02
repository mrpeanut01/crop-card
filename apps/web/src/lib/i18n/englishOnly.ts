/**
 * Messages that stay English until a human agricultural reviewer signs off
 * (Q-I18N-SAFETY, F5-6). `t()` returns English for these in every locale,
 * and the catalog check fails when one of them has a translation.
 */
export const ENGLISH_ONLY_PREFIXES = [
  'safety.',
  'kernel.',
  'decon.',
  'harvest.stop',
  'spray.',
  'insecticide.',
  'fungicide.',
  'withdrawal.',
  'grazing.',
  'hold.',
  'label.'
] as const;

export const ENGLISH_ONLY_KEYS: readonly string[] = [];

export function isEnglishOnly(key: string): boolean {
  return ENGLISH_ONLY_KEYS.includes(key) || ENGLISH_ONLY_PREFIXES.some((p) => key.startsWith(p));
}
