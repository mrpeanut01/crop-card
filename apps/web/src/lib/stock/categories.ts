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
