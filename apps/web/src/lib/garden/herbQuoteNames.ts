/** Phase 37C: the words a source must use to name each herb before its
 *  preserving or cadence quote counts for that plugin. A ruled table, so a
 *  lemon verbena quote never counts for lemon balm; `herbQuoteNames.test.ts`
 *  keeps it covering every id in `HERB_PLUGIN_IDS`. Client-safe, no imports. */
export const HERB_QUOTE_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'basil-genovese': ['basil'],
  'chives-common': ['chive'],
  'mint-spearmint': ['spearmint', 'mint'],
  'oregano-greek': ['oregano'],
  'rosemary-tuscan-blue': ['rosemary'],
  'sage-broadleaf': ['sage'],
  'thyme-german-winter': ['thyme'],
  'anise-hyssop': ['anise hyssop', 'agastache'],
  'bergamot-monarda': ['bergamot', 'monarda', 'bee balm'],
  'catnip-common': ['catnip'],
  'hyssop-officinalis': ['hyssop'],
  'lavender-english-munstead': ['lavender'],
  'lemon-balm': ['lemon balm'],
  'lemon-verbena': ['lemon verbena'],
  'lemongrass-east-indian': ['lemongrass', 'lemon grass'],
  'marjoram-sweet': ['marjoram'],
  'mountain-mint': ['mountain mint'],
  'perilla-shiso-green': ['perilla', 'shiso'],
  'stevia-sweetleaf': ['stevia'],
  'summer-savory': ['savory'],
  'tarragon-french': ['tarragon'],
  'tulsi-holy-basil-rama': ['tulsi', 'holy basil'],
  'parsley-italian-flat-leaf': ['parsley'],
  'cilantro-santo': ['cilantro', 'coriander'],
  'dill-mammoth': ['dill'],
  chervil: ['chervil'],
  'fennel-bulb-perfection': ['fennel'],
  'fennel-florence-zefa-fino': ['fennel'],
  lovage: ['lovage'],
  'chamomile-german': ['chamomile'],
  'calendula-resina': ['calendula', 'pot marigold'],
  'nasturtium-companion': ['nasturtium']
});

/** The names a quote may use for a crop: the ruled herb names, else the
 *  display name up to its first dash, bracket or comma. */
export function cropQuoteNames(c: { pluginId: string; displayName: string }): readonly string[] {
  const ruled = HERB_QUOTE_NAMES[c.pluginId];
  if (ruled) return ruled;
  const head = c.displayName
    .split(/\s[—–-]\s|\(|,/)[0]
    .trim()
    .toLowerCase();
  return head ? [head] : [];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Names of other plants that hold a herb's name ("Russian sage" is not
 *  sage). */
const OTHER_HERB_NAMES: readonly string[] = [
  'russian sage',
  'mexican oregano',
  'cuban oregano',
  'mexican tarragon'
];

function namePattern(name: string): string {
  return `(?<![a-z])${escapeRe(name.toLowerCase()).replace(/\s+/g, '\\s+')}(?:e?s)?(?![a-z])`;
}

/** CO-9: the quote with every longer herb name blanked out that holds one
 *  of `own` without being one of them, so "mountain mint" never names
 *  spearmint and "holy basil" never names basil. */
export function withoutLongerHerbNames(quote: string, own: readonly string[]): string {
  const ownLower = own.map((n) => n.toLowerCase());
  const longer = [...new Set([...Object.values(HERB_QUOTE_NAMES).flat(), ...OTHER_HERB_NAMES])]
    .filter(
      (n) =>
        !ownLower.includes(n) &&
        ownLower.some((o) => n.length > o.length && new RegExp(namePattern(o), 'i').test(n))
    )
    .sort((a, b) => b.length - a.length);
  let text = quote;
  for (const n of longer) text = text.replace(new RegExp(namePattern(n), 'gi'), ' ');
  return text;
}

/** True when `quote` names one of `names` as a whole word, singular or
 *  plural, and not inside a longer herb name. */
export function quoteNamesAny(quote: string, names: readonly string[]): boolean {
  const text = withoutLongerHerbNames(quote, names);
  return names.some((name) => new RegExp(namePattern(name), 'i').test(text));
}

/** True when the quote names the crop, singular or plural. */
export function quoteNamesCrop(
  quote: string,
  c: { pluginId: string; displayName: string }
): boolean {
  return quoteNamesAny(quote, cropQuoteNames(c));
}
