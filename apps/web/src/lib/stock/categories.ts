import { t, type MessageKey } from '$lib/i18n';

/** Stock item categories. Phase 32D adds feed, bedding and animal-health. */
export type StockCategory =
  | 'herbicide'
  | 'insecticide'
  | 'fungicide'
  | 'fertilizer'
  | 'seed'
  | 'adjuvant'
  | 'fuel'
  | 'part'
  | 'feed'
  | 'bedding'
  | 'animal-health';

export const STOCK_CATEGORIES: readonly StockCategory[] = [
  'herbicide',
  'insecticide',
  'fungicide',
  'fertilizer',
  'seed',
  'adjuvant',
  'fuel',
  'part',
  'feed',
  'bedding',
  'animal-health'
];

const STOCK_CATEGORY_KEYS: Record<StockCategory, MessageKey> = {
  herbicide: 'stockui.cat.herbicide',
  insecticide: 'stockui.cat.insecticide',
  fungicide: 'stockui.cat.fungicide',
  fertilizer: 'stockui.cat.fertilizer',
  seed: 'stockui.cat.seed',
  adjuvant: 'stockui.cat.adjuvant',
  fuel: 'stockui.cat.fuel',
  part: 'stockui.cat.part',
  feed: 'stockui.cat.feed',
  bedding: 'stockui.cat.bedding',
  'animal-health': 'stockui.cat.animalHealth'
};

/** A stock category as a lower-case word for display ("herbicide"). English
 *  returns the stored code unchanged; an unknown category is shown as is. */
export function stockCategoryLabel(category: string, locale?: string | null): string {
  const key = Object.prototype.hasOwnProperty.call(STOCK_CATEGORY_KEYS, category)
    ? STOCK_CATEGORY_KEYS[category as StockCategory]
    : undefined;
  return key ? t(locale, key) : category;
}
