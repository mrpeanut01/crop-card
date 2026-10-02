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

/**
 * Reasons a template region may stay English, marked with
 * `<span lang="en" data-english-only="safety">` (or `regulatory`). The
 * `cropcard/no-raw-text` ESLint rule skips such regions and refuses any other
 * reason; its `DEFAULT_REASONS` must equal this list (englishOnly.test.ts).
 * `safety`: kernel stops, rates, mix order, PHI/REI, pollinator, decon,
 * withdrawal, grazing, haying and hold text. `regulatory`: 7 CFR 205 quotes
 * and citations, and the registered SMS consent line.
 */
export const ENGLISH_ONLY_REASONS = ['safety', 'regulatory'] as const;
export type EnglishOnlyReason = (typeof ENGLISH_ONLY_REASONS)[number];
